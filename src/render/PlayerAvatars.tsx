import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MOVEMENT } from '@/config/movement';
import { teamColor, teamEmissive } from '@/config/teams';
import type { Actor } from '@/gameplay/types';
import { lerp } from '@/util/math';
import { useGame } from './GameContext';

/**
 * Third-person player avatars, drawn instanced.
 *
 * Built from primitives rather than an imported model: the silhouette is the readable part of a
 * laser tag player, and a helmet/vest/limb blockout with emissive team trim reads at range far
 * better than a detailed mesh would at this stage. The rig's joint names and the pose function
 * below are the same interface an animated Mixamo character will implement in the art pass, so
 * swapping the visual does not touch anything that drives it.
 *
 * The rig is fifteen pieces. Drawn as ordinary meshes that is fifteen draw calls *per player* —
 * 75 for a five-bot match and 240 for a full sixteen, on top of the arena. Since every player wears
 * the same rig and differs only in team colour, the pieces are drawn as `InstancedMesh` batches
 * keyed by (geometry, material) instead: one batch per body part, with one instance per player.
 * The cost becomes a constant ~18 draw calls no matter how many people are in the match.
 *
 * Posing still happens on a normal Object3D hierarchy — the `scratch` skeleton below — which is
 * posed once per actor per frame and read back as world matrices. That keeps the animation code
 * identical to the hierarchical version it replaced, and keeps the parent/child relationships that
 * make lean, crouch and aim compose correctly. Only the submission changes.
 */

interface Props {
  colorblind: boolean;
  enemyOutlines: boolean;
  localTeam: string;
}

/** Which material a body part wears. Armour is team-independent; the rest carry team colour. */
type PartKind = 'armor' | 'trim' | 'visor' | 'marker' | 'outline';

/** Maximum simultaneous avatars. Matches the server's `maxClients` plus bot headroom. */
const MAX_AVATARS = 24;

export function PlayerAvatars({ colorblind, enemyOutlines, localTeam }: Props) {
  const game = useGame();

  const geometries = useMemo(
    () => ({
      leg: new THREE.CapsuleGeometry(0.11, 0.5, 4, 8),
      arm: new THREE.CapsuleGeometry(0.085, 0.4, 4, 8),
      torso: new THREE.BoxGeometry(0.52, 0.62, 0.32),
      head: new THREE.SphereGeometry(0.19, 14, 12),
      chest: new THREE.BoxGeometry(0.2, 0.2, 0.06),
      back: new THREE.BoxGeometry(0.34, 0.08, 0.05),
      shoulder: new THREE.BoxGeometry(0.1, 0.26, 0.26),
      crest: new THREE.BoxGeometry(0.06, 0.06, 0.3),
      visor: new THREE.BoxGeometry(0.28, 0.11, 0.14),
      marker: new THREE.TorusGeometry(0.17, 0.032, 6, 14),
      outline: new THREE.CapsuleGeometry(0.36, 1.0, 4, 10),
    }),
    [],
  );

  const teams = useMemo(() => game.match.settings.teams, [game]);

  /** One material per (kind, team). Armour is shared outright — it carries no team information. */
  const materials = useMemo(() => {
    const armor = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.45, metalness: 0.55 });
    const byTeam = new Map<string, { trim: THREE.Material; visor: THREE.Material; marker: THREE.Material; outline: THREE.Material }>();
    for (const team of teams) {
      const base = teamColor(team, colorblind);
      const glow = teamEmissive(team, colorblind);
      byTeam.set(team, {
        trim: new THREE.MeshStandardMaterial({
          color: base,
          emissive: glow,
          emissiveIntensity: 2.6,
          roughness: 0.4,
          metalness: 0.2,
          toneMapped: false,
        }),
        visor: new THREE.MeshStandardMaterial({
          color: 0x0a1018,
          emissive: glow,
          emissiveIntensity: 0.9,
          roughness: 0.08,
          metalness: 0.9,
        }),
        marker: new THREE.MeshBasicMaterial({ color: glow, toneMapped: false, transparent: true, opacity: 0.85 }),
        outline: new THREE.MeshBasicMaterial({
          color: glow,
          side: THREE.BackSide,
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
        }),
      });
    }
    return { armor, byTeam };
  }, [teams, colorblind]);

  /**
   * The scratch skeleton.
   *
   * Never added to the scene — it exists purely to be posed and read. Local transforms that do not
   * animate are baked in here once, so the per-frame work is only the handful of joints that move.
   */
  const scratch = useMemo(() => {
    const root = new THREE.Object3D();
    const torso = new THREE.Object3D();
    const head = new THREE.Object3D();

    const make = (parent: THREE.Object3D, position: [number, number, number]) => {
      const node = new THREE.Object3D();
      node.position.set(...position);
      parent.add(node);
      return node;
    };

    root.add(torso, head);
    const legL = make(root, [-0.14, 0.78, 0]);
    const legR = make(root, [0.14, 0.78, 0]);
    const marker = make(root, [0, 2.1, 0]);
    marker.rotation.x = Math.PI / 2;
    const outline = make(root, [0, 0.95, 0]);
    outline.scale.set(1.14, 1.08, 1.14);

    const torsoBody = make(torso, [0, 0, 0]);
    const chest = make(torso, [0, 0.05, 0.18]);
    const back = make(torso, [0, 0.08, -0.18]);
    const shoulderL = make(torso, [-0.3, 0.2, 0]);
    const shoulderR = make(torso, [0.3, 0.2, 0]);
    const armL = make(torso, [-0.36, 0.12, 0]);
    const armR = make(torso, [0.36, 0.12, 0]);

    const headBody = make(head, [0, 0, 0]);
    const visor = make(head, [0, -0.01, -0.13]);
    const crest = make(head, [0, 0.15, 0]);

    return { root, torso, head, legL, legR, marker, outline, torsoBody, chest, back, shoulderL, shoulderR, armL, armR, headBody, visor, crest };
  }, []);

  /**
   * The batches, and which skeleton nodes feed each one.
   *
   * Parts sharing a geometry and a material share a batch, so both shoulders and both legs go into
   * one `InstancedMesh` with two instances per actor rather than two batches of one.
   */
  const batches = useMemo(() => {
    const spec: Array<{ key: string; geometry: THREE.BufferGeometry; kind: PartKind; nodes: THREE.Object3D[] }> = [
      { key: 'leg', geometry: geometries.leg, kind: 'armor', nodes: [scratch.legL, scratch.legR] },
      { key: 'arm', geometry: geometries.arm, kind: 'armor', nodes: [scratch.armL, scratch.armR] },
      { key: 'torso', geometry: geometries.torso, kind: 'armor', nodes: [scratch.torsoBody] },
      { key: 'head', geometry: geometries.head, kind: 'armor', nodes: [scratch.headBody] },
      { key: 'chest', geometry: geometries.chest, kind: 'trim', nodes: [scratch.chest] },
      { key: 'back', geometry: geometries.back, kind: 'trim', nodes: [scratch.back] },
      { key: 'shoulder', geometry: geometries.shoulder, kind: 'trim', nodes: [scratch.shoulderL, scratch.shoulderR] },
      { key: 'crest', geometry: geometries.crest, kind: 'trim', nodes: [scratch.crest] },
      { key: 'visor', geometry: geometries.visor, kind: 'visor', nodes: [scratch.visor] },
      { key: 'marker', geometry: geometries.marker, kind: 'marker', nodes: [scratch.marker] },
      { key: 'outline', geometry: geometries.outline, kind: 'outline', nodes: [scratch.outline] },
    ];

    const made: Array<{ mesh: THREE.InstancedMesh; nodes: THREE.Object3D[]; team: string | null; kind: PartKind }> = [];
    for (const part of spec) {
      const capacity = MAX_AVATARS * part.nodes.length;
      if (part.kind === 'armor') {
        // One batch for everybody: armour carries no team colour, so splitting it by team would
        // only add draw calls.
        const mesh = new THREE.InstancedMesh(part.geometry, materials.armor, capacity);
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        made.push({ mesh, nodes: part.nodes, team: null, kind: part.kind });
      } else {
        for (const team of teams) {
          const material = materials.byTeam.get(team)![part.kind];
          const mesh = new THREE.InstancedMesh(part.geometry, material, capacity);
          mesh.frustumCulled = false;
          made.push({ mesh, nodes: part.nodes, team, kind: part.kind });
        }
      }
    }
    return made;
  }, [geometries, materials, scratch, teams]);

  const phases = useRef(new Map<number, number>());
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const actors = [...game.match.state.actors.values()].filter((a) => a.kind !== 'local' && a.alive);
    const counts = new Map<THREE.InstancedMesh, number>();
    for (const batch of batches) counts.set(batch.mesh, 0);

    for (const actor of actors) {
      poseSkeleton(scratch, actor, game.alpha, delta, phases.current);
      scratch.root.updateMatrixWorld(true);

      for (const batch of batches) {
        // A batch is either team-agnostic (armour) or belongs to one team; outlines additionally
        // only apply to enemies, and are suppressed by the settings toggle.
        if (batch.team !== null && batch.team !== actor.team) continue;
        if (batch.kind === 'outline' && (!enemyOutlines || actor.team === localTeam)) continue;

        let index = counts.get(batch.mesh)!;
        for (const node of batch.nodes) {
          batch.mesh.setMatrixAt(index++, node.matrixWorld);
        }
        counts.set(batch.mesh, index);
      }
    }

    for (const batch of batches) {
      const count = counts.get(batch.mesh)!;
      batch.mesh.count = count;
      // Frustum culling is off — an instanced batch's bounding volume is the rig at the origin,
      // not the union of its instances, so Three.js would cull the whole team the moment the
      // untransformed prototype left the view. Hiding empty batches replaces what culling would
      // otherwise have done for the common case: an empty batch is still a submitted draw call,
      // and with no enemies alive that would be eighteen calls to draw nothing.
      batch.mesh.visible = count > 0;
      if (count > 0) batch.mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef}>
      {batches.map((batch, i) => (
        <primitive key={i} object={batch.mesh} />
      ))}
    </group>
  );
}

/** The posable joint set. Names match the rig interface an authored character will implement. */
interface Skeleton {
  root: THREE.Object3D;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  marker: THREE.Object3D;
  outline: THREE.Object3D;
  torsoBody: THREE.Object3D;
  chest: THREE.Object3D;
  back: THREE.Object3D;
  shoulderL: THREE.Object3D;
  shoulderR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  headBody: THREE.Object3D;
  visor: THREE.Object3D;
  crest: THREE.Object3D;
}

/**
 * Poses the scratch skeleton for one actor.
 *
 * Unchanged in behaviour from the hierarchical version: stance drives height, lean tilts the torso
 * and head, the legs cycle from horizontal speed, and the right arm tracks aim instead of swinging
 * because it is holding the rifle.
 */
function poseSkeleton(
  s: Skeleton,
  actor: Actor,
  alpha: number,
  delta: number,
  phases: Map<number, number>,
): void {
  s.root.position.set(
    lerp(actor.prevPosition.x, actor.position.x, alpha),
    lerp(actor.prevPosition.y, actor.position.y, alpha),
    lerp(actor.prevPosition.z, actor.position.z, alpha),
  );
  s.root.rotation.set(0, actor.yaw, 0);

  const stanceScale = actor.height / MOVEMENT.standHeight;
  s.torso.position.y = 0.92 * stanceScale;
  s.torso.scale.y = 0.75 + 0.25 * stanceScale;
  s.torso.rotation.z = -actor.lean * 0.28;
  s.torso.rotation.x = actor.stance === 'slide' ? 0.55 : 0;

  s.head.position.y = 1.52 * stanceScale;
  s.head.rotation.x = -actor.pitch * 0.75;
  s.head.rotation.z = -actor.lean * 0.2;

  // Per-actor phase, so avatars do not march in lockstep.
  const phase = (phases.get(actor.id) ?? (actor.id * 1.7) % (Math.PI * 2)) +
    delta * (2.0 + Math.hypot(actor.velocity.x, actor.velocity.z) * 1.35);
  phases.set(actor.id, phase);

  const speed = Math.hypot(actor.velocity.x, actor.velocity.z);
  const swing = actor.grounded ? Math.sin(phase) * Math.min(0.7, speed * 0.11) : 0.15;
  s.legL.rotation.x = swing;
  s.legR.rotation.x = -swing;
  s.armL.rotation.x = -swing * 0.5;
  s.armR.rotation.x = -actor.pitch * 0.8 - 1.15;

  s.marker.rotation.y += delta * 1.4;
  s.marker.position.y = 2.1 * stanceScale + Math.sin(phase * 0.5) * 0.04;
}
