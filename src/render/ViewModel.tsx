import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { teamColor, teamEmissive } from '@/config/teams';
import { WEAPONS } from '@/config/weapons';
import { clamp, damp } from '@/util/math';
import { useGame } from './GameContext';
import { photonMaterial } from './materials/PhotonMaterials';
import { partMaterial, scanRig, useAsset } from '@/assets/useAsset';
import { clearMuzzle, publishMuzzle } from './MuzzleRegistry';

/**
 * First-person weapon view model.
 *
 * Parented to the camera each frame rather than added as a child of it, so the sway can lag the
 * camera by a frame — that lag is most of what makes a weapon feel like it has weight. Rendered on
 * layer 1 with its own near plane so it can never clip into world geometry.
 */

interface Props {
  colorblind: boolean;
}

const REST_POSITION = new THREE.Vector3(0.16, -0.15, -0.5);
const ADS_POSITION = new THREE.Vector3(0, -0.075, -0.42);

/**
 * The vertical FOV the first-person transform was composed at.
 *
 * Everything below — rest offset, scale, how close the muzzle sits to the reticle — is a *framing*
 * decision, and framing is a function of FOV. Tuned at one FOV and left uncompensated, the weapon
 * shrinks as a player widens their FOV and balloons as they narrow it, which is exactly the "world
 * object that happens to be near the camera" look this pass exists to remove.
 */
const VIEW_MODEL_REFERENCE_FOV = 65;

/**
 * How far the view model is allowed to be rescaled to hold its apparent size.
 *
 * Compensation grows the mesh about the root origin, so an unbounded factor at a very wide FOV would
 * push the receiver through the near plane — the failure this file spends most of its budget
 * avoiding. The clamp is the guard; `NEAR_PLANE_MARGIN` below is what it was sized against.
 */
const FOV_COMPENSATION_RANGE: readonly [number, number] = [0.6, 1.2];

/**
 * Hip and ADS are two authored poses, not one pose at two sizes.
 *
 * The brief is explicit that ADS must read as the weapon being physically brought into the sight
 * line, so each state carries its own offset *and* its own resting rotation. Interpolating between
 * them is what produces the movement; scaling a single pose would only produce a zoom.
 */
const HIP = {
  position: new THREE.Vector3(0.17, -0.151, -0.288),
  /** Muzzle-up so the weapon lies diagonally across the corner rather than flat across the edge. */
  pitch: 0.10,
  /** Slight toe-in, so the barrel converges toward the reticle instead of running parallel to it. */
  yaw: 0.055,
  roll: 0.06,
} as const;

/**
 * ADS.
 *
 * Relative to `HIP` the weapon swings inboard (x 0.17 -> 0.006) and back (z -0.40 -> -0.34 effective),
 * losing its cant and roll, so the player ends up looking *along* the receiver instead of at the side
 * of it. That change of viewing axis — not a size change — is what reads as aiming.
 *
 * ## Why the bore sits just below the aim point
 *
 * Solving for the muzzle landing exactly on the reticle put the barrel *on* the aim point, and the
 * reticle raycast then hit geometry on all five probes: with no sight raised above the bore, aligning
 * the bore necessarily occludes what it is aligned with. Real weapons buy that clearance with sight
 * height, and the PH-6 has no `SOCKET_sight` to raise.
 *
 * So the weapon is held low enough that its *rail* — the highest thing on it, and the real occluder —
 * passes below the aim point: bore at 0.345 NDC below centre, probes clear at 0, 16 and 28 px. An
 * intermediate 0.181 still failed, because clearing the muzzle is not the same as clearing the optic
 * above it. What survives is the read that matters: the player looks straight down the receiver, the
 * barrel recedes toward the reticle and the front sight post is visible against it.
 *
 * An authored `SOCKET_sight` is what would let the bore come up to centre properly, by giving the
 * sight line real height over the bore instead of borrowing it from this offset. See the socket note
 * below.
 */
const ADS = {
  position: new THREE.Vector3(0.006, -0.130, -0.264),
  pitch: 0.012,
  yaw: 0.0,
  roll: 0.0,
} as const;

/**
 * Recoil.
 *
 * The PH-6 discharges energy, so the read is a mechanical thump and a settle rather than a firearm's
 * muzzle climb: a short push back along the barrel, a small nose-up rotation, and a trace of lateral
 * variance so repeated shots do not stack into a perfectly vertical ladder.
 *
 * `halfLife` is seconds, so recovery to 10% is `halfLife * log2(10)` ≈ 3.32 half-lives — 133 ms at
 * 0.040, inside the 100–180 ms the brief asks for. The back-push is deliberately small: it moves the
 * receiver *toward* the near plane, and `NEAR_PLANE_MARGIN` is what pays for it.
 */
const RECOIL = { back: 0.030, pitch: 0.075, yaw: 0.020, halfLife: 0.040, perShot: 0.75 } as const;

/** Look-inertia: the weapon lags the camera, which is most of what gives it apparent mass. */
const LOOK = { gain: 6, max: 0.10, halfLife: 0.09, positionYaw: 1.0, rotationYaw: 1.5, roll: 0.85 } as const;

/** Idle breathing. Two incommensurate periods, so the cycle never visibly repeats. */
const IDLE = { x: 0.0035, y: 0.0042, rateA: 1.15, rateB: 0.73, roll: 0.006 } as const;

/** Movement. `bobX`/`bobY` come from the movement system; these only decide how much reaches the weapon. */
const MOVEMENT = { bobX: 1.0, bobY: 1.0, strafeX: 0.020, strafeRoll: 0.055, accelZ: 0.022 } as const;

/** Sprint and slide lower the weapon out of the sight line without hiding it. */
const SPRINT = { y: 0.10, z: 0.030, pitch: 0.30, yaw: 0.32, roll: 0.24, enter: 6.4, range: 2.4 } as const;

/** How much of all of the above survives at full ADS. Aiming is meant to feel tight. */
const ADS_SWAY_SUPPRESSION = 0.82;

/**
 * Closest any weapon vertex may come to the camera, in metres, against a 0.05 near plane.
 *
 * This is the constraint that sets the scale, and it is not negotiable by eye: the rifle is 0.98 m
 * long, and at the size that "looks right" its receiver crosses the near plane and is sliced open
 * mid-recoil.
 *
 * Measured against the real code path at the shipped scale, not simulated: 0.104 m at rest, 0.075 m
 * under sustained fire (the worst state), 0.090 m sprinting — the sprint pose lowers the weapon and
 * so moves it away. 0.065 is therefore a floor with the true worst case above it and the 0.05 near
 * plane below. Raising `IMPORTED_SCALE` without re-measuring will clip the receiver while firing.
 */
const NEAR_PLANE_MARGIN = 0.065;

/**
 * First-person framing for the **imported** PH-6.
 *
 * The procedural fallback and the authored asset are different objects with different sizes and
 * different origins, so one set of numbers cannot serve both. The procedural rifle was built around
 * `REST_POSITION` and `VIEW_MODEL_SCALE`; the imported mesh is 0.98 m long with its origin at the
 * bounding-box centre, and reusing those values put it across the middle of the screen.
 *
 * ## The grip offset
 *
 * The asset has no `SOCKET_grip`, so there is nothing to anchor to and the model pivots about its
 * bounding-box centre — which makes sway rotate the whole rifle around its midpoint like a propeller
 * rather than around the hand. `IMPORTED_GRIP` shifts the mesh inside its own group so the grip sits
 * at the pivot: back along the barrel axis, and down to hand height.
 *
 * This is a runtime stand-in, deliberately. When `SOCKET_grip` is authored in Blender the socket
 * should replace these numbers — see the asset note in the manifest entry.
 */
const IMPORTED_SCALE = 0.62;
/** Mesh offset inside the rotated group, putting the grip on the pivot rather than the bbox centre. */
// Forward is -Z. The first pass used +0.26 and pushed the whole rifle behind the camera, which
// rendered an empty frame — a reminder that this offset is in the parent's space, not the rotated
// mesh's. -0.18 brings the grip onto the pivot instead of the bounding-box centre.
const IMPORTED_GRIP = new THREE.Vector3(0, -0.03, -0.18);

/**
 * View-model scale.
 *
 * The rifle is authored at roughly life size (~0.9 m long), which at 0.4 m from a 95-degree camera
 * filled a quarter of the screen — it read as a glowing slab rather than a weapon. Real shooters
 * render the view model with its own narrow FOV; scaling it down here achieves the same framing
 * without a second render pass, and keeps it clear of the crosshair.
 */
const VIEW_MODEL_SCALE = 0.55;

export function ViewModel({ colorblind }: Props) {
  const game = useGame();
  const { camera } = useThree();
  const root = useRef<THREE.Group>(null);
  const emitter = useRef<THREE.Mesh>(null);
  const muzzle = useRef<THREE.PointLight>(null);
  const sway = useRef({
    yaw: 0,
    pitch: 0,
    kick: 0,
    muzzleLife: 0,
    /** Damped strafe input, so lateral roll eases in rather than snapping with the key. */
    strafe: 0,
    /** Damped forward acceleration, which is what makes starting and stopping read as weight. */
    accel: 0,
    prevSpeed: 0,
    /** Per-shot lateral kick, re-rolled on each shot so a burst does not climb a straight line. */
    kickYaw: 0,
  });
  /** Read inside the frame loop, which cannot call hooks. */
  const importedRef = useRef(false);
  const railPhase = useRef(0);
  /** Throttles the dev near-plane guard, and keeps it to one warning per mount. */
  const nearCheck = useRef({ at: 0, warned: false });

  /**
   * The imported hero rifle, when one exists.
   *
   * Null for a clean checkout, which is the normal state — the procedural rifle below is the
   * fallback. Dropping `HeroLaserRifle_v01.glb` into `public/assets/weapons/` is the entire
   * integration step; no code below changes.
   */
  const imported = useAsset('hero_rifle');

  /**
   * A private copy of the rifle, because `LoadedAsset.scene` is shared and this one is React-managed.
   *
   * Mounting the shared scene here rendered **nothing at all**, and the transform numbers below were
   * being applied to an empty group for as long as that lasted. `<primitive>` hands the object to the
   * reconciler, and on unmount R3F recursively detaches its children — so the first remount of this
   * component (a colourblind toggle, a fast-refresh, StrictMode's double-mount) permanently emptied
   * `imported.scene`. The avatars kept working only because they clone per slot and parent
   * imperatively, which is why the asset looked healthy in third person while the view model was bare.
   *
   * An Object3D has exactly one parent, so a shared asset can never be mounted in two places. Clone
   * here and the ownership question disappears; `dispose={null}` then stops the reconciler disposing
   * geometry and materials that the clone only borrows and 24 avatars are still drawing with.
   */
  const gun = useMemo(() => (imported ? (imported.scene.clone(true) as THREE.Group) : null), [imported]);
  importedRef.current = gun !== null;

  /**
   * Addressable parts, scanned from whichever subtree is present.
   *
   * Both sources follow the same contract: the procedural meshes are *named* `PART_core`,
   * `PART_rail_03` and so on, exactly as an imported asset's nodes would be. The animation below
   * therefore has one code path, not two, and cannot drift between them.
   */
  const rig = useRef<{ parts: Map<string, THREE.Object3D>; sockets: Map<string, THREE.Object3D> }>({
    parts: new Map(),
    sockets: new Map(),
  });
  const rigVersion = useRef(-1);

  const local = game.localActor!;

  // Stop publishing when the view model goes away, so a stale muzzle cannot outlive the weapon that
  // owned it and drag the next player's bolts toward wherever this one was last standing.
  useEffect(() => () => clearMuzzle(local.id), [local.id]);

  const base = teamColor(local.team, colorblind);
  const glow = teamEmissive(local.team, colorblind);

  /**
   * Weapon materials, from the shared library.
   *
   * Every substance here passes `worldScale: false`. The rifle sits ~0.4 m from the near plane and
   * occupies a large solid angle, so emissive values tuned for world geometry read as a glowing slab
   * once bloom is applied — the library scales them down rather than each call site guessing.
   *
   * `unique: true` on the animated parts: the charge rails, core and emitter mutate their emissive
   * every frame, and a shared instance would drive every other object made of the same substance.
   */
  const shell = useMemo(
    () => photonMaterial('carbonFibre', { color: 0x272f3d, worldScale: false }),
    [],
  );
  const frame = useMemo(
    () => photonMaterial('brushedAluminium', { color: 0x5b6679, worldScale: false }),
    [],
  );
  const grip = useMemo(
    () => photonMaterial('rubberGrip', { color: 0x14181f, worldScale: false }),
    [],
  );
  const trim = useMemo(
    () => photonMaterial('ledStrip', { color: base, emissive: glow }),
    [base, glow],
  );
  const coreMaterial = useMemo(
    () =>
      photonMaterial('energyEmitter', {
        color: glow,
        emissive: glow,
        worldScale: false,
        unique: true,
      }) as THREE.MeshStandardMaterial,
    [glow],
  );
  const emitterMaterial = useMemo(
    () =>
      photonMaterial('energyEmitter', {
        color: glow,
        emissive: glow,
        worldScale: false,
        unique: true,
      }) as THREE.MeshStandardMaterial,
    [glow],
  );
  const railMaterial = useMemo(
    () =>
      photonMaterial('energyEmitter', {
        color: glow,
        emissive: glow,
        worldScale: false,
        unique: true,
      }) as THREE.MeshStandardMaterial,
    [glow],
  );
  const cellMaterial = useMemo(
    () => photonMaterial('ledStrip', { color: glow, emissive: glow }),
    [glow],
  );
  const cellEmptyMaterial = useMemo(
    () => photonMaterial('paintedAlloy', { color: 0x2a313d, worldScale: false }),
    [],
  );
  const vent = useMemo(
    () => photonMaterial('titanium', { color: 0x3a4352, worldScale: false }),
    [],
  );

  useFrame(({ clock }, delta) => {
    const group = root.current;
    if (!group) return;
    const dt = Math.min(delta, 0.05);
    const view = game.view;
    const actor = game.localActor;
    if (!actor) return;

    group.visible = actor.alive;

    // Follow the camera exactly, then apply local-space offsets. Nothing below writes to the camera:
    // the camera decides where the player is aiming and the weapon only reacts to it, which is why
    // sway can be this liberal without ever pulling the reticle off target.
    group.position.copy(camera.position);
    group.quaternion.copy(camera.quaternion);

    const s = sway.current;
    const ads = actor.weapon.adsBlend;
    const useImported = importedRef.current;

    /**
     * Hold apparent size constant against the player's FOV setting.
     *
     * Compensating against the *live* FOV covers both the player's FOV setting and the ADS zoom. The
     * first version divided out `view.fovScale` to let ADS magnify the weapon "naturally", and the
     * capture showed why that is wrong: a 65 -> 47 degree zoom is 1.47x linear, the weapon went from
     * 12% of the frame to 48%, and the raycast found it covering the reticle on all five probes.
     *
     * With the zoom compensated, apparent size is decided by the ADS *pose* below rather than
     * inherited from the sight's magnification — which is the whole point of a view-model treatment.
     */
    const perspective = camera as THREE.PerspectiveCamera;
    const liveFov = perspective.isPerspectiveCamera ? perspective.fov : VIEW_MODEL_REFERENCE_FOV;
    const fovCompensation = clamp(
      Math.tan((liveFov * Math.PI) / 360) / Math.tan((VIEW_MODEL_REFERENCE_FOV * Math.PI) / 360),
      FOV_COMPENSATION_RANGE[0],
      FOV_COMPENSATION_RANGE[1],
    );
    group.scale.setScalar((useImported ? IMPORTED_SCALE : VIEW_MODEL_SCALE) * fovCompensation);

    // --- Handling inputs ---------------------------------------------------------------------
    // Look inertia: the weapon chases the camera's angular velocity with a lag.
    s.yaw = damp(s.yaw, clamp(-actor.input.lookYaw * LOOK.gain, -LOOK.max, LOOK.max), LOOK.halfLife, dt);
    s.pitch = damp(s.pitch, clamp(-actor.input.lookPitch * LOOK.gain, -LOOK.max, LOOK.max), LOOK.halfLife, dt);
    // Strafe and acceleration, both damped so they express momentum rather than key state.
    s.strafe = damp(s.strafe, clamp(actor.input.moveX, -1, 1), 0.11, dt);
    const speed = view.speed;
    const accelRaw = dt > 0 ? clamp((speed - s.prevSpeed) / dt / 30, -1, 1) : 0;
    s.prevSpeed = speed;
    s.accel = damp(s.accel, accelRaw, 0.10, dt);

    // Recoil decays toward rest; each shot adds to it and re-rolls the lateral component.
    s.kick = damp(s.kick, 0, RECOIL.halfLife, dt);
    s.kickYaw = damp(s.kickYaw, 0, RECOIL.halfLife, dt);
    if (actor.fx.firedThisTick) {
      s.kick = Math.min(1, s.kick + RECOIL.perShot);
      s.kickYaw = (Math.random() * 2 - 1) * RECOIL.yaw;
    }

    // Sprinting and sliding lower the weapon out of the sight line — moved aside, never hidden.
    const lowered =
      actor.stance === 'slide' ? 1 : clamp((speed - SPRINT.enter) / SPRINT.range, 0, 1) * (1 - ads);

    // How much handling motion survives at this ADS blend.
    const loose = 1 - ads * ADS_SWAY_SUPPRESSION;
    // Breathing only reads when the player is otherwise still.
    const stillness = clamp(1 - speed / 2.5, 0, 1) * loose;
    const t = clock.elapsedTime;

    // --- Position ----------------------------------------------------------------------------
    // The procedural fallback is a different object with different proportions, so it keeps the
    // poses it was built around. `HIP`/`ADS` describe the imported PH-6 only.
    const target = useImported
      ? TMP_A.copy(HIP.position).lerp(ADS.position, ads)
      : TMP_A.copy(REST_POSITION).lerp(ADS_POSITION, ads);
    target.x +=
      (s.yaw * LOOK.positionYaw + view.bobX * MOVEMENT.bobX + s.strafe * MOVEMENT.strafeX) * loose +
      Math.sin(t * IDLE.rateB) * IDLE.x * stillness;
    target.y +=
      (s.pitch + view.bobY * MOVEMENT.bobY) * loose + Math.sin(t * IDLE.rateA) * IDLE.y * stillness;
    target.z += s.kick * RECOIL.back + lowered * SPRINT.z + s.accel * MOVEMENT.accelZ;
    target.y -= lowered * SPRINT.y;

    group.translateX(target.x);
    group.translateY(target.y);
    group.translateZ(target.z);

    // --- Rotation ----------------------------------------------------------------------------
    // Base pose first, so hip and ADS differ in attitude and not merely in offset; handling rides
    // on top of whichever pose the blend has landed on.
    const basePitch = useImported ? HIP.pitch + (ADS.pitch - HIP.pitch) * ads : 0;
    const baseYaw = useImported ? HIP.yaw + (ADS.yaw - HIP.yaw) * ads : 0;
    const baseRoll = useImported ? HIP.roll + (ADS.roll - HIP.roll) * ads : 0;

    group.rotateX(basePitch + s.kick * RECOIL.pitch - lowered * SPRINT.pitch + s.pitch * loose);
    group.rotateY(baseYaw + s.yaw * LOOK.rotationYaw * loose + s.kickYaw - lowered * SPRINT.yaw);
    group.rotateZ(
      baseRoll +
        (s.yaw * LOOK.roll + s.strafe * MOVEMENT.strafeRoll) * loose +
        Math.sin(t * IDLE.rateB) * IDLE.roll * stillness +
        lowered * SPRINT.roll,
    );

    /**
     * Dev guard on the near plane.
     *
     * Near-plane clipping is the one failure here that never announces itself: the weapon simply
     * loses its receiver at the frame edge during recoil, which reads as a modelling fault rather
     * than a transform one. Anyone raising `IMPORTED_SCALE` or a recoil push should hear about it
     * immediately. The world AABB is a looser bound than the real vertices, so this errs toward
     * warning early — which is the right direction for a guard.
     */
    if (import.meta.env.DEV && t - nearCheck.current.at > 0.5) {
      nearCheck.current.at = t;
      TMP_BOX.setFromObject(group);
      let closest = Infinity;
      for (let i = 0; i < 8; i++) {
        TMP_B.set(
          i & 1 ? TMP_BOX.max.x : TMP_BOX.min.x,
          i & 2 ? TMP_BOX.max.y : TMP_BOX.min.y,
          i & 4 ? TMP_BOX.max.z : TMP_BOX.min.z,
        );
        closest = Math.min(closest, -camera.worldToLocal(TMP_B).z);
      }
      if (closest < NEAR_PLANE_MARGIN && !nearCheck.current.warned) {
        nearCheck.current.warned = true;
        console.warn(
          `[viewmodel] weapon came within ${closest.toFixed(3)} m of the camera, inside the ` +
            `${NEAR_PLANE_MARGIN} m margin (near plane ${camera.near}). Lower IMPORTED_SCALE, or ` +
            `the recoil/sprint z push, or expect the receiver to be clipped open while firing.`,
        );
      }
    }

    // Charge cells: lit for remaining shots, dark once spent, refilling during a recharge.
    const config = WEAPONS[actor.weapon.id];
    const filled = actor.weapon.recharging
      ? actor.weapon.rechargeProgress * config.cellCapacity
      : actor.weapon.charge;
    for (let i = 0; i < config.cellCapacity; i++) {
      const cell = rig.current.parts.get(`cell_${String(i).padStart(2, '0')}`) as THREE.Mesh | undefined;
      if (!cell) continue;
      const lit = i < filled;
      cell.material = lit ? cellMaterial : cellEmptyMaterial;
      cell.scale.setScalar(lit ? 1 : 0.72);
    }

    // Rescan when the geometry source changes — once on mount, and again if an imported asset
    // arrives after the procedural fallback has already rendered.
    const version = imported ? 1 : 0;
    if (rigVersion.current !== version) {
      rigVersion.current = version;
      rig.current = scanRig(group);
    }
    const parts = rig.current.parts;

    // Emitter glows hotter as the cell drains, which reads as heat build-up.
    const heat = 1 - actor.weapon.charge / config.cellCapacity;
    const emitterMat = partMaterial(parts.get('emitter')) ?? emitterMaterial;
    emitterMat.emissiveIntensity = 0.6 + heat * 1.6 + sway.current.kick * 1.8;

    /**
     * Charging rails and energy core.
     *
     * The rails travel: a bright band runs from the stock to the emitter while the cell recharges,
     * and idles as a slow breath when the weapon is ready. This is the weapon telling the player
     * what it is doing without them looking away from the fight — the same job the HUD charge ring
     * does, done in the world, and it is the animation that most makes the rifle feel powered
     * rather than held.
     */
    const charging = actor.weapon.recharging;
    railPhase.current = charging
      ? actor.weapon.rechargeProgress
      : (railPhase.current + delta * 0.35) % 1;

    // Rails are discovered, not counted: an asset may ship any number of `PART_rail_NN` nodes and
    // the band spreads across however many it finds.
    const rails: THREE.Object3D[] = [];
    for (let i = 0; i < 32; i++) {
      const rail = parts.get(`rail_${String(i).padStart(2, '0')}`);
      if (!rail) break;
      rails.push(rail);
    }

    for (let i = 0; i < rails.length; i++) {
      const rail = rails[i];
      // Each segment lights as the travelling band passes it.
      const at = i / Math.max(1, rails.length - 1);
      const distance = Math.abs(at - railPhase.current);
      const near = Math.max(0, 1 - distance * 6);
      const idle = charging ? 0 : 0.12;
      rail.scale.setScalar(0.85 + near * 0.35);
      const mat = partMaterial(rail);
      if (mat) mat.emissiveIntensity = (idle + near * (charging ? 1.5 : 0.5)) * 1.2;
    }
    railMaterial.emissiveIntensity = charging ? 1.2 : 0.35;

    // Core pulses with remaining charge — full and steady when loaded, faint and fast when empty.
    const chargeFraction = actor.weapon.charge / config.cellCapacity;
    const coreMat = partMaterial(parts.get('core')) ?? coreMaterial;
    coreMat.emissiveIntensity =
      0.35 + chargeFraction * 1.1 + Math.sin(t * (charging ? 9 : 2.4)) * 0.18;

    // Muzzle light rides the asset's socket when one is supplied, so an imported rifle with a
    // differently-placed barrel lights from the right point with no code change.
    const muzzleSocket = rig.current.sockets.get('muzzle');
    if (muzzleSocket) {
      muzzleSocket.getWorldPosition(TMP_A);
      // Publish *before* converting. `worldToLocal` transforms its argument in place, so reading
      // TMP_A afterwards yields the muzzle in view-model space — which measured as a 31.9 m error
      // against the simulated origin instead of the real 0.44 m, and put every bolt near the world
      // origin. Order matters here and nothing about the types says so.
      publishMuzzle(actor.id, TMP_A);
      if (muzzle.current) muzzle.current.position.copy(group.worldToLocal(TMP_A));
    }

    // Muzzle flash light.
    if (actor.fx.firedThisTick) sway.current.muzzleLife = 0.06;
    sway.current.muzzleLife = Math.max(0, sway.current.muzzleLife - dt);
    if (muzzle.current) {
      muzzle.current.intensity = (sway.current.muzzleLife / 0.06) * 9;
    }
  });

  // An imported hero rifle replaces the primitives entirely. Everything else in this component —
  // sway, kick, ADS blend, charge rails, core pulse, muzzle light — is unchanged and drives it
  // through the same name-addressed parts.
  if (imported && gun) {
    /**
     * The manifest's `yawOffset` has to be applied here too.
     *
     * `AssetAvatars` folds it into the avatar root, so a third-person weapon points the right way
     * and this branch looked correct by association. It is not: the imported PH-6 is authored with
     * its long axis on **X**, the engine points weapons down **-Z**, and without the quarter turn
     * the rifle renders broadside across the middle of the screen with the muzzle aimed at the
     * player's right ear.
     *
     * Read from the entry rather than hard-coded, so an asset re-exported in the correct
     * orientation just sets `yawOffset: 0` and this keeps working.
     */
    const yaw = imported.entry.yawOffset ?? 0;
    return (
      <group ref={root}>
        <group rotation={[0, yaw, 0]} position={IMPORTED_GRIP}>
          <primitive object={gun} dispose={null} />
        </group>
        <pointLight ref={muzzle} color={glow} intensity={0} distance={5} decay={2} />
      </group>
    );
  }

  return (
    <group ref={root}>
      {/*
        PH-6 Photon Rifle — procedural fallback.
        ------------------
        Sports equipment, not a military weapon. The silhouette reads as a competition instrument:
        a long low body, an exposed energy spine, and a visible core — the parts that do the work are
        on show, the way a track bike or a racing shell shows its structure. Nothing on it is
        armour, nothing is camouflaged, and there is no magazine, because it does not fire bullets.

        Built from ~30 primitives rather than an imported mesh. That is a deliberate ceiling and the
        honest limit of this approach: the proportions, materials and animation are production-grade,
        the surface detail is not, and a modelled asset would replace the geometry below without
        touching a line of the animation above it.
      */}

      {/* --- Core body ------------------------------------------------- */}
      {/* Lower receiver: the structural spine everything hangs off. */}
      <mesh material={shell} position={[0, -0.012, 0]} castShadow={false}>
        <boxGeometry args={[0.062, 0.072, 0.46]} />
      </mesh>
      {/* Upper shroud, narrower — the step between them is what gives the body a silhouette. */}
      <mesh material={frame} position={[0, 0.042, -0.04]}>
        <boxGeometry args={[0.05, 0.032, 0.4]} />
      </mesh>
      {/* Chamfer plates along the flanks, breaking the slab into panels. */}
      {[-1, 1].map((side) => (
        <mesh
          key={`flank${side}`}
          material={frame}
          position={[side * 0.034, 0.004, -0.02]}
          rotation={[0, 0, side * 0.35]}
        >
          <boxGeometry args={[0.014, 0.05, 0.36]} />
        </mesh>
      ))}

      {/* --- Energy spine: the defining feature ------------------------ */}
      {/* Exposed rail channel running the length of the body. */}
      <mesh material={vent} position={[0, 0.026, -0.02]}>
        <boxGeometry args={[0.03, 0.016, 0.38]} />
      </mesh>
      {/* Charge rail segments — a travelling band runs these while recharging. */}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh
          key={`rail${i}`}
          name={`PART_rail_${String(i).padStart(2, '0')}`}
          material={railMaterial}
          position={[0, 0.034, 0.14 - i * 0.048]}
        >
          <boxGeometry args={[0.02, 0.006, 0.026]} />
        </mesh>
      ))}

      {/* Energy core: a visible chamber behind a transparent housing. */}
      <mesh name="PART_core" material={coreMaterial} position={[0, -0.004, 0.045]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.021, 0.021, 0.075, 12]} />
      </mesh>
      <mesh material={frame} position={[0, -0.004, 0.045]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.024, 0.005, 6, 14]} />
      </mesh>

      {/* --- Heat management ------------------------------------------- */}
      {/* Vent fins over the chamber. Angled so they catch the key light as the weapon sways. */}
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={`fin${i}`} material={vent} position={[0, 0.056, 0.02 + i * 0.026]} rotation={[0.22, 0, 0]}>
          <boxGeometry args={[0.044, 0.004, 0.016]} />
        </mesh>
      ))}
      {/* Side exhaust ports. */}
      {[-1, 1].map((side) => (
        <mesh key={`port${side}`} material={vent} position={[side * 0.033, -0.008, 0.1]}>
          <boxGeometry args={[0.006, 0.03, 0.05]} />
        </mesh>
      ))}

      {/* --- Barrel and emitter ---------------------------------------- */}
      <mesh material={frame} position={[0, 0.016, -0.33]}>
        <boxGeometry args={[0.042, 0.046, 0.3]} />
      </mesh>
      {/* Barrel shroud slots, which read as cooling and break up a long flat run. */}
      {Array.from({ length: 4 }, (_, i) => (
        <mesh key={`slot${i}`} material={vent} position={[0, 0.038, -0.26 - i * 0.05]}>
          <boxGeometry args={[0.03, 0.004, 0.024]} />
        </mesh>
      ))}
      {/* Emitter housing and the tip itself. */}
      <mesh material={frame} position={[0, 0.016, -0.47]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.032, 0.032, 0.03, 12]} />
      </mesh>
      <mesh name="PART_emitter" ref={emitter} material={emitterMaterial} position={[0, 0.016, -0.5]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.019, 0.027, 0.05, 12]} />
      </mesh>
      {/* Emitter prongs — the shape that makes the muzzle recognisable in a screenshot. */}
      {[-1, 1].map((side) => (
        <mesh key={`prong${side}`} material={frame} position={[side * 0.026, 0.016, -0.475]}>
          <boxGeometry args={[0.008, 0.03, 0.055]} />
        </mesh>
      ))}

      {/* --- Handling --------------------------------------------------- */}
      <mesh material={grip} position={[0, -0.108, 0.075]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[0.05, 0.15, 0.062]} />
      </mesh>
      {/* Trigger guard. */}
      <mesh material={frame} position={[0, -0.062, 0.026]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.026, 0.005, 6, 12, Math.PI]} />
      </mesh>
      {/* Fore grip, angled — the second contact point that says "held with two hands". */}
      <mesh material={grip} position={[0, -0.062, -0.24]} rotation={[-0.24, 0, 0]}>
        <boxGeometry args={[0.036, 0.085, 0.05]} />
      </mesh>
      {/* Stock: a skeleton frame rather than a solid block, which is what keeps it sporting. */}
      <mesh material={frame} position={[0, 0.006, 0.27]}>
        <boxGeometry args={[0.04, 0.014, 0.13]} />
      </mesh>
      <mesh material={frame} position={[0, -0.058, 0.27]}>
        <boxGeometry args={[0.04, 0.012, 0.13]} />
      </mesh>
      <mesh material={shell} position={[0, -0.026, 0.325]}>
        <boxGeometry args={[0.046, 0.086, 0.03]} />
      </mesh>

      {/* --- Team identity and status ----------------------------------- */}
      {/* Team trim along the upper flank, visible to other players as well as the holder. */}
      {[-1, 1].map((side) => (
        <mesh key={`trim${side}`} material={trim} position={[side * 0.027, 0.03, -0.12]}>
          <boxGeometry args={[0.004, 0.008, 0.22]} />
        </mesh>
      ))}
      {/* Sight ring, the ADS reference point. */}
      <mesh material={frame} position={[0, 0.075, -0.26]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.019, 0.004, 6, 14]} />
      </mesh>
      <mesh material={trim} position={[0, 0.075, -0.26]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.013, 0.0016, 6, 14]} />
      </mesh>

      {/* Status display on the left flank: charge cells, readable at a glance while aiming. */}
      <mesh material={vent} position={[-0.034, -0.022, -0.06]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[0.2, 0.036]} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh
          key={`cell${i}`}
          name={`PART_cell_${String(i).padStart(2, '0')}`}
          position={[-0.0355, -0.022, -0.14 + i * 0.023]}
          rotation={[0, -Math.PI / 2, 0]}
          material={cellMaterial}
        >
          <planeGeometry args={[0.016, 0.022]} />
        </mesh>
      ))}

      {/* Sockets. The procedural rifle declares the same attachment points the contract requires of
          an imported one, so systems that mount to them work identically against either. */}
      <object3D name="SOCKET_muzzle" position={[0, 0.016, -0.55]} />
      <object3D name="SOCKET_grip" position={[0, -0.108, 0.075]} />
      <object3D name="SOCKET_sight" position={[0, 0.075, -0.26]} />

      <pointLight ref={muzzle} position={[0, 0.016, -0.55]} color={glow} intensity={0} distance={5} decay={2} />
    </group>
  );
}

const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_BOX = new THREE.Box3();
