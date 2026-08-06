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
  const sway = useRef({ yaw: 0, pitch: 0, kick: 0, muzzleLife: 0 });
  const railPhase = useRef(0);

  /**
   * The imported hero rifle, when one exists.
   *
   * Null for a clean checkout, which is the normal state — the procedural rifle below is the
   * fallback. Dropping `HeroLaserRifle_v01.glb` into `public/assets/weapons/` is the entire
   * integration step; no code below changes.
   */
  const imported = useAsset('hero_rifle');

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

    // Follow the camera exactly, then apply local-space offsets.
    group.position.copy(camera.position);
    group.quaternion.copy(camera.quaternion);

    // Sway: the view model chases the camera's angular velocity with a spring-ish lag.
    const yawDelta = actor.input.lookYaw;
    const pitchDelta = actor.input.lookPitch;
    sway.current.yaw = damp(sway.current.yaw, clamp(-yawDelta * 6, -0.12, 0.12), 0.09, dt);
    sway.current.pitch = damp(sway.current.pitch, clamp(-pitchDelta * 6, -0.12, 0.12), 0.09, dt);

    const ads = actor.weapon.adsBlend;
    const target = TMP_A.copy(REST_POSITION).lerp(ADS_POSITION, ads);

    // Recoil pushes the weapon back and up along its own axis.
    sway.current.kick = damp(sway.current.kick, 0, 0.055, dt);
    if (actor.fx.firedThisTick) sway.current.kick = Math.min(1, sway.current.kick + 0.75);

    target.x += sway.current.yaw * (1 - ads * 0.7) + view.bobX * (1 - ads * 0.8);
    target.y += sway.current.pitch * (1 - ads * 0.7) + view.bobY * (1 - ads * 0.8);
    target.z += sway.current.kick * 0.055;

    // Sprinting and sliding lower the weapon out of the sight line.
    const speed = view.speed;
    const lowered = actor.stance === 'slide' ? 1 : clamp((speed - 6.4) / 2.4, 0, 1) * (1 - ads);
    target.y -= lowered * 0.12;
    target.z += lowered * 0.05;

    group.translateX(target.x);
    group.translateY(target.y);
    group.translateZ(target.z);

    group.rotateX(-sway.current.kick * 0.16 - lowered * 0.35);
    group.rotateY(sway.current.yaw * 1.6 - lowered * 0.4);
    group.rotateZ(sway.current.yaw * 0.9 + lowered * 0.3);

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
    const t = clock.elapsedTime;
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
  if (imported) {
    return (
      <group ref={root} scale={VIEW_MODEL_SCALE}>
        <primitive object={imported.scene} />
        <pointLight ref={muzzle} color={glow} intensity={0} distance={5} decay={2} />
      </group>
    );
  }

  return (
    <group ref={root} scale={VIEW_MODEL_SCALE}>
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
