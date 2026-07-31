import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { teamColor, teamEmissive } from '@/config/teams';
import { WEAPONS } from '@/config/weapons';
import { clamp, damp } from '@/util/math';
import { useGame } from './GameContext';

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
  const cellRefs = useRef<Array<THREE.Mesh | null>>([]);
  const muzzle = useRef<THREE.PointLight>(null);
  const sway = useRef({ yaw: 0, pitch: 0, kick: 0, muzzleLife: 0 });

  const local = game.localActor!;
  const base = teamColor(local.team, colorblind);
  const glow = teamEmissive(local.team, colorblind);

  const bodyMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0x232a36, roughness: 0.38, metalness: 0.72 }),
    [],
  );
  const accentMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: base,
        emissive: glow,
        // Kept low: the view model sits ~0.4 m from the near plane, so it occupies a large solid
        // angle. Emissive values tuned for world geometry read as a glowing slab at this distance
        // once bloom is applied, which is exactly how it looked the first time it was seen.
        emissiveIntensity: 0.55,
        roughness: 0.35,
        metalness: 0.2,
      }),
    [base, glow],
  );
  const cellMaterial = useMemo(
    () =>
      // Tone-mapped so the charge cells sit in the same exposure range as everything else. With
      // toneMapped:false they stayed at full intensity regardless of scene exposure and bloomed
      // into a solid bar across the lower screen.
      new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.85 }),
    [glow],
  );
  const cellEmptyMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: 0x1b222c, toneMapped: false }),
    [],
  );
  const emitterMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: base,
        emissive: glow,
        emissiveIntensity: 0.9,
      }),
    [base, glow],
  );

  useFrame((_, delta) => {
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
    for (let i = 0; i < cellRefs.current.length; i++) {
      const cell = cellRefs.current[i];
      if (!cell) continue;
      const lit = i < filled;
      cell.material = lit ? cellMaterial : cellEmptyMaterial;
      cell.scale.setScalar(lit ? 1 : 0.72);
    }

    // Emitter glows hotter as the cell drains, which reads as heat build-up.
    if (emitter.current) {
      const heat = 1 - actor.weapon.charge / config.cellCapacity;
      const material = emitter.current.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = 0.6 + heat * 1.6 + sway.current.kick * 1.8;
    }

    // Muzzle flash light.
    if (actor.fx.firedThisTick) sway.current.muzzleLife = 0.06;
    sway.current.muzzleLife = Math.max(0, sway.current.muzzleLife - dt);
    if (muzzle.current) {
      muzzle.current.intensity = (sway.current.muzzleLife / 0.06) * 9;
    }
  });

  return (
    <group ref={root} scale={VIEW_MODEL_SCALE}>
      {/* Receiver */}
      <mesh material={bodyMaterial} position={[0, 0, 0]}>
        <boxGeometry args={[0.075, 0.1, 0.42]} />
      </mesh>
      {/* Barrel shroud */}
      <mesh material={bodyMaterial} position={[0, 0.012, -0.32]}>
        <boxGeometry args={[0.055, 0.062, 0.28]} />
      </mesh>
      {/* Emitter tip */}
      <mesh
        ref={emitter}
        position={[0, 0.012, -0.47]}
        material={emitterMaterial}
      >
        <cylinderGeometry args={[0.028, 0.038, 0.07, 10]} />
      </mesh>
      {/* Grip */}
      <mesh material={bodyMaterial} position={[0, -0.11, 0.08]} rotation={[0.28, 0, 0]}>
        <boxGeometry args={[0.055, 0.16, 0.07]} />
      </mesh>
      {/* Stock */}
      <mesh material={bodyMaterial} position={[0, -0.02, 0.24]}>
        <boxGeometry args={[0.05, 0.09, 0.16]} />
      </mesh>
      {/* Top rail accent */}
      <mesh material={accentMaterial} position={[0, 0.058, -0.05]}>
        <boxGeometry args={[0.022, 0.012, 0.3]} />
      </mesh>
      {/* Iron sight ring, the ADS reference point */}
      <mesh material={accentMaterial} position={[0, 0.075, -0.24]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.021, 0.005, 6, 12]} />
      </mesh>

      {/* Charge cell indicator strip along the receiver */}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh
          key={i}
          ref={(node) => {
            cellRefs.current[i] = node;
          }}
          position={[0.041, -0.028, -0.13 + i * 0.052]}
          material={cellMaterial}
        >
          <boxGeometry args={[0.008, 0.026, 0.03]} />
        </mesh>
      ))}

      <pointLight ref={muzzle} position={[0, 0.012, -0.52]} color={glow} intensity={0} distance={5} decay={2} />
    </group>
  );
}

const TMP_A = new THREE.Vector3();
