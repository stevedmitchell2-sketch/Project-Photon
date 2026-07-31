import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MOVEMENT } from '@/config/movement';
import { teamColor, teamEmissive } from '@/config/teams';
import type { Actor } from '@/gameplay/types';
import { lerp } from '@/util/math';
import { useGame } from './GameContext';

/**
 * Third-person player avatars.
 *
 * Built from primitives rather than an imported model: the silhouette is the readable part of a
 * laser tag player, and a helmet/vest/limb blockout with emissive team trim reads at range far
 * better than a detailed mesh would at this stage. The rig's joint names and the pose function
 * below are the same interface an animated Mixamo character will implement in the art pass, so
 * swapping the visual does not touch anything that drives it.
 */

interface Props {
  colorblind: boolean;
  enemyOutlines: boolean;
  localTeam: string;
}

export function PlayerAvatars({ colorblind, enemyOutlines, localTeam }: Props) {
  const game = useGame();
  const actors = useMemo(
    () => [...game.match.state.actors.values()].filter((a) => a.kind !== 'local'),
    [game],
  );

  return (
    <group>
      {actors.map((actor) => (
        <Avatar
          key={actor.id}
          actor={actor}
          colorblind={colorblind}
          outline={enemyOutlines && actor.team !== localTeam}
        />
      ))}
    </group>
  );
}

function Avatar({ actor, colorblind, outline }: { actor: Actor; colorblind: boolean; outline: boolean }) {
  const game = useGame();
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const marker = useRef<THREE.Mesh>(null);
  const phase = useRef(Math.random() * Math.PI * 2);

  const base = teamColor(actor.team, colorblind);
  const glow = teamEmissive(actor.team, colorblind);

  const armorMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x2a3140,
        roughness: 0.45,
        metalness: 0.55,
      }),
    [],
  );
  const trimMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: base,
        emissive: glow,
        emissiveIntensity: 2.6,
        roughness: 0.4,
        metalness: 0.2,
        toneMapped: false,
      }),
    [base, glow],
  );
  const visorMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x0a1018,
        emissive: glow,
        emissiveIntensity: 0.9,
        roughness: 0.08,
        metalness: 0.9,
      }),
    [glow],
  );

  useFrame((_, delta) => {
    const group = root.current;
    if (!group) return;

    // Hide dead players entirely — respawn is instant enough that a ragdoll would be noise.
    group.visible = actor.alive;
    if (!actor.alive) return;

    const alpha = game.alpha;
    group.position.set(
      lerp(actor.prevPosition.x, actor.position.x, alpha),
      lerp(actor.prevPosition.y, actor.position.y, alpha),
      lerp(actor.prevPosition.z, actor.position.z, alpha),
    );
    group.rotation.y = actor.yaw;

    // Stance drives overall height; crouch and slide compress the rig rather than scaling it.
    const stanceScale = actor.height / MOVEMENT.standHeight;
    if (torso.current) {
      torso.current.position.y = 0.92 * stanceScale;
      torso.current.scale.y = 0.75 + 0.25 * stanceScale;
      torso.current.rotation.z = -actor.lean * 0.28;
      torso.current.rotation.x = actor.stance === 'slide' ? 0.55 : 0;
    }
    if (head.current) {
      head.current.position.y = 1.52 * stanceScale;
      head.current.rotation.x = -actor.pitch * 0.75;
      head.current.rotation.z = -actor.lean * 0.2;
    }

    // Leg cycle from horizontal speed. This is the hook the motion-matching system replaces.
    const speed = Math.hypot(actor.velocity.x, actor.velocity.z);
    phase.current += delta * (2.0 + speed * 1.35);
    const swing = actor.grounded ? Math.sin(phase.current) * Math.min(0.7, speed * 0.11) : 0.15;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = -swing * 0.5;
    if (armR.current) {
      // Right arm holds the rifle: it points where the actor aims instead of swinging.
      armR.current.rotation.x = -actor.pitch * 0.8 - 1.15;
    }

    if (marker.current) {
      marker.current.rotation.y += delta * 1.4;
      marker.current.position.y = 2.1 * stanceScale + Math.sin(phase.current * 0.5) * 0.04;
    }
  });

  return (
    <group ref={root}>
      {/* Legs */}
      <mesh ref={legL} position={[-0.14, 0.78, 0]} material={armorMaterial} castShadow>
        <capsuleGeometry args={[0.11, 0.5, 4, 8]} />
      </mesh>
      <mesh ref={legR} position={[0.14, 0.78, 0]} material={armorMaterial} castShadow>
        <capsuleGeometry args={[0.11, 0.5, 4, 8]} />
      </mesh>

      {/* Torso: vest plate with a glowing chest module and back trim */}
      <group ref={torso}>
        <mesh material={armorMaterial} castShadow>
          <boxGeometry args={[0.52, 0.62, 0.32]} />
        </mesh>
        <mesh position={[0, 0.05, 0.18]} material={trimMaterial}>
          <boxGeometry args={[0.2, 0.2, 0.06]} />
        </mesh>
        <mesh position={[0, 0.08, -0.18]} material={trimMaterial}>
          <boxGeometry args={[0.34, 0.08, 0.05]} />
        </mesh>
        <mesh position={[-0.3, 0.2, 0]} material={trimMaterial}>
          <boxGeometry args={[0.1, 0.26, 0.26]} />
        </mesh>
        <mesh position={[0.3, 0.2, 0]} material={trimMaterial}>
          <boxGeometry args={[0.1, 0.26, 0.26]} />
        </mesh>

        {/* Arms */}
        <mesh ref={armL} position={[-0.36, 0.12, 0]} material={armorMaterial} castShadow>
          <capsuleGeometry args={[0.085, 0.4, 4, 8]} />
        </mesh>
        <mesh ref={armR} position={[0.36, 0.12, 0]} material={armorMaterial} castShadow>
          <capsuleGeometry args={[0.085, 0.4, 4, 8]} />
        </mesh>
      </group>

      {/* Helmet with visor band */}
      <group ref={head}>
        <mesh material={armorMaterial} castShadow>
          <sphereGeometry args={[0.19, 14, 12]} />
        </mesh>
        <mesh position={[0, -0.01, -0.13]} material={visorMaterial}>
          <boxGeometry args={[0.28, 0.11, 0.14]} />
        </mesh>
        <mesh position={[0, 0.15, 0]} material={trimMaterial}>
          <boxGeometry args={[0.06, 0.06, 0.3]} />
        </mesh>
      </group>

      {/* Overhead team marker: hue plus a distinct ring keeps teams readable without colour alone */}
      <mesh ref={marker} position={[0, 2.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.17, 0.032, 6, 14]} />
        <meshBasicMaterial color={glow} toneMapped={false} transparent opacity={0.85} />
      </mesh>

      {outline && (
        <mesh position={[0, 0.95, 0]} scale={[1.14, 1.08, 1.14]}>
          <capsuleGeometry args={[0.36, 1.0, 4, 10]} />
          <meshBasicMaterial color={glow} side={THREE.BackSide} transparent opacity={0.14} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
