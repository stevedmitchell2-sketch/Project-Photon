import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AssetAnimator, clipCoverage, clipFor, normaliseClipName } from '@/assets/AssetAnimator';
import { useAsset } from '@/assets/useAsset';
import { teamEmissive } from '@/config/teams';
import { lerp } from '@/util/math';
import { isDev } from '@/util/env';
import { useGame } from './GameContext';
import { characterStates } from './CharacterStateMapper';
import { publishMuzzle, clearMuzzle } from './MuzzleRegistry';

/**
 * Third-person avatars drawn from an **imported character asset**.
 *
 * The other half of a two-source character system. `PlayerAvatars` draws the primitive blockout as
 * instanced batches; this draws a skinned glTF with real skeletal animation. Exactly one of them is
 * active, decided by `useImportedCharacters()` — whether the asset exists on disk.
 *
 * ## Why a sibling rather than a branch inside PlayerAvatars
 *
 * The blockout's whole design is that fifteen body parts become eighteen `InstancedMesh` batches, so
 * the draw-call cost is constant no matter how many players are in the match. A skinned mesh cannot
 * join that scheme: every skeleton is different every frame, so each character is its own draw call
 * and its own skinning pass.
 *
 * Those are not two configurations of one renderer, they are two renderers. Branching inside
 * `PlayerAvatars` would have meant threading a condition through the batch construction, the pose
 * loop and the submission loop, and the fallback — the thing that has to keep working — would have
 * been the harder path to reason about. As a sibling, the fallback is untouched code.
 *
 * ## Cost, stated plainly
 *
 * This path trades draw calls for fidelity and the trade is not small. The blockout is ~18 calls for
 * any number of players. This is roughly one call per material zone **per player**, plus a CPU
 * skinning update per skeleton. That is the correct trade for a game with sixteen players only if
 * the character is inside its triangle budget — see CHARACTER_OPTIMIZATION_PLAN.md.
 */

/** Hard cap on simultaneous imported avatars. Beyond this, actors fall back to nothing rendered. */
const MAX_ASSET_AVATARS = 24;

/**
 * The registry id of the character asset.
 *
 * `hero_robot` is the authored Photon Arena Service Unit. `hero_athlete` is the
 * generated reference character the pipeline was proven against — kept in the
 * registry because it is regenerable in one command and useful for testing this
 * path without the real asset present.
 */
export const CHARACTER_ASSET_ID = 'hero_robot';

/**
 * Clip names that count as a purpose-built right turn.
 *
 * Runtime mirroring of a skeletal clip means reflecting every track and swapping every left/right
 * bone pair — a real feature, and one that would live in `AssetAnimator` rather than here. This is
 * the cheap 90%: if the asset ships a right turn, use it; otherwise the left-turn clip covers both
 * directions, which on a 0.22 s turn-in-place is a detail nobody sees at arena distance.
 *
 * Checked directly against the animator's clip list rather than through `clipFor`, because `clipFor`
 * falls back to the asset's only clip and would therefore report a right turn for every asset that
 * ships one animation.
 */
const RIGHT_TURN_CLIPS = ['right_turn', 'turn_right', 'turning_right'];

/** Resolves the turning state, taking a dedicated right-turn clip when the asset has one. */
function turnClipFor(animator: AssetAnimator, turnSign: number): string | null {
  if (turnSign > 0) {
    const alias = animator.aliases.turning_right;
    if (alias && animator.has(alias)) return alias;
    const match = animator.available.find((name) =>
      RIGHT_TURN_CLIPS.includes(normaliseClipName(name)),
    );
    if (match) return match;
  }
  return clipFor(animator, 'turning');
}

/**
 * A restrained emissive face element, mounted on the character's helmet socket.
 *
 * Task 3 asks for cyan identity on the head. The asset has none there and adding it
 * properly means editing the mesh — so instead this hangs off `SOCKET_helmet`, which
 * is already parented to the head bone. The asset, rig, weights and materials are
 * untouched, and the accent inherits head animation for free.
 *
 * ## Why this shape
 *
 * A single horizontal visor bar plus two small sensor pips either side. Horizontal
 * reads as *optics* — a scanner, a face — where vertical or angular reads as a
 * threat display, and the brief is explicit that this must communicate intelligence
 * and friendliness rather than combat.
 *
 * Deliberately small: 5 cm of bar on a 25 cm head. The brief warns against neon
 * overload twice, and at arena distance a thin bright line is legible where a large
 * glowing panel just becomes a blob under bloom.
 *
 * Unlit `MeshBasicMaterial` rather than emissive standard: this is a light source
 * behind a lens, not a painted surface, and basic material means it holds its colour
 * regardless of how the arena happens to be lighting the head.
 */
const HEAD_ACCENT = {
  /**
   * Distance in front of the avatar's centreline, in root-local metres.
   *
   * Measured, after three failed attempts at deriving it from the socket. The
   * helmet socket sits at root-local z **+0.28** — 28 cm behind the centreline —
   * because a Mixamo head bone's origin is at the base of the skull, not the face.
   * Every offset applied relative to the socket therefore started 28 cm too far
   * back, which is exactly the error that kept showing up: 0.53, then 0.20, then
   * 0.28 m behind the head.
   *
   * So the socket is used for *height only*, and depth comes from the model's own
   * front. 0.11 m clears a head roughly 0.22 m deep.
   */
  forward: 0.11,
  /** Below the socket, which sits at the crown. */
  drop: 0.1,
  visor: { width: 0.05, height: 0.014, depth: 0.012 },
  pip: { size: 0.011, offset: 0.037 },
};

function buildHeadAccent(color: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'PHOTON_head_accent';

  // Laid out around the group's own origin. The group is then placed in socket space
  // by `calibrateAccent`, so nothing here needs to know the rig's axes.
  const material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const v = HEAD_ACCENT.visor;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(v.width, v.height, v.depth), material);
  group.add(bar);

  const p = HEAD_ACCENT.pip;
  for (const side of [-1, 1]) {
    const pip = new THREE.Mesh(new THREE.BoxGeometry(p.size, p.size, p.size * 0.7), material);
    pip.position.set(side * p.offset, 0.012, 0);
    group.add(pip);
  }

  group.userData.photonAccentMaterial = material;
  return group;
}

/**
 * Positions the head accent on the face, in the avatar root's own space.
 *
 * Parented to the root, not to the head socket. Socket-local placement was tried
 * three times and failed each time — the accent landed 0.53 m, then 0.20 m, then
 * 0.28 m behind the skull — because a Mixamo head bone's local axes bear no fixed
 * relationship to the character's facing, and every attempt to infer which axis
 * points forward was a guess dressed up as arithmetic.
 *
 * Root space has no such ambiguity. `root.rotation.y` is set to the actor's yaw and
 * nothing else, and the model faces -Z in its own space, so **-Z in root space is
 * the face**. That is true by construction rather than by inspection.
 *
 * The cost of not parenting to the bone is that the accent tracks the head's
 * position but not its rotation. For a 5 cm bar that is not a visible loss, and it
 * is steadier: it cannot swing off the face when the clip turns the head.
 */
function placeHeadAccent(accent: THREE.Object3D, socket: THREE.Object3D, root: THREE.Object3D): void {
  socket.getWorldPosition(ACCENT_SCRATCH);
  root.worldToLocal(ACCENT_SCRATCH);
  // Height from the socket, so it rides the head as the clip bobs. Lateral and depth
  // from the model's own centreline and front, because the socket's own x/z carry the
  // head bone's origin rather than the face — see HEAD_ACCENT.forward.
  accent.position.set(0, ACCENT_SCRATCH.y - HEAD_ACCENT.drop, -HEAD_ACCENT.forward);
}

const ACCENT_SCRATCH = new THREE.Vector3();

interface Slot {
  root: THREE.Group;
  animator: AssetAnimator;
  /** The weapon's muzzle socket, when a weapon was attached. */
  muzzle: THREE.Object3D | null;
  /** Material of the head accent, so team colour can be written to it. */
  accent: THREE.MeshBasicMaterial | null;
  /** The accent group and its socket, for one-time placement calibration. */
  accentNode: THREE.Object3D | null;
  accentSocket: THREE.Object3D | null;
  /**
   * Materials cloned per slot so team colour can be written without repainting everyone.
   *
   * Typed as the base class on purpose. A team zone maps to whichever substance the manifest names,
   * and the library returns `MeshBasicMaterial` for some of them — `ledStrip` among them, which is
   * exactly what the reference character's `trim` zone uses. Assuming `MeshStandardMaterial` here
   * threw on `emissive.setHex` for the first avatar and, because the frame loop is one pass over all
   * actors, silently stopped every remaining player from being drawn at all.
   */
  teamMaterials: THREE.Material[];
  actorId: number | null;
  lastState: string;
}

interface Props {
  colorblind: boolean;
}

/**
 * Whether imported characters are in use this session.
 *
 * A hook rather than a constant because the asset resolves asynchronously: the blockout draws
 * everyone until the file has loaded, then hands over. Both components call this and act on the
 * same boolean in the same frame, so no actor is ever drawn twice or missed.
 */
export function useImportedCharacters(): boolean {
  return useAsset(CHARACTER_ASSET_ID) !== null;
}

export function AssetAvatars({ colorblind }: Props) {
  const game = useGame();
  const character = useAsset(CHARACTER_ASSET_ID);
  const weapon = useAsset('hero_rifle');
  const groupRef = useRef<THREE.Group>(null);
  const slots = useRef<Slot[]>([]);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);

  // Build the pool once the asset arrives. Clones share geometry and textures; only the skeleton and
  // the team-coloured material instances are per-slot.
  useEffect(() => {
    const group = groupRef.current;
    if (!character || !group) return;

    const made: Slot[] = [];
    for (let i = 0; i < MAX_ASSET_AVATARS; i++) {
      // `SkeletonUtils.clone` rather than `Object3D.clone`: the latter copies a SkinnedMesh but
      // leaves it bound to the *original* skeleton, so every avatar would animate identically and
      // stand wherever the first one stands.
      const root = cloneSkinned(character.scene) as THREE.Group;
      root.visible = false;
      group.add(root);

      const teamMaterials: THREE.Material[] = [];
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !mesh.userData?.teamColored) return;
        const source = mesh.material as THREE.Material;
        const unique = source.clone();
        mesh.material = unique;
        teamMaterials.push(unique);
      });

      // Head accent, if the asset exposes a helmet socket.
      let accent: THREE.MeshBasicMaterial | null = null;
      let accentNode: THREE.Object3D | null = null;
      let helmet: THREE.Object3D | null = null;
      root.traverse((node) => {
        if (node.name === 'SOCKET_helmet' || node.name === 'helmet') helmet = node;
      });
      if (helmet) {
        const built = buildHeadAccent(0x2de0ff);
        // On the root, not the socket — see placeHeadAccent. The socket stays hidden
        // and is read only for its world position.
        root.add(built);
        accent = built.userData.photonAccentMaterial as THREE.MeshBasicMaterial;
        accentNode = built;
      }

      made.push({
        root,
        animator: new AssetAnimator({ ...character, scene: root }),
        muzzle: null,
        accent,
        accentNode,
        accentSocket: helmet,
        teamMaterials,
        actorId: null,
        lastState: '',
      });
    }
    slots.current = made;

    // Surface a clip library that covers nothing. This is silent otherwise: the
    // character animates, so it appears to work, and it takes noticing that a
    // standing player is playing a run cycle to catch it.
    if (made.length > 0 && isDev()) {
      const coverage = clipCoverage(made[0].animator);
      if (coverage.resolved === 0) {
        console.warn(
          `[assets] "${CHARACTER_ASSET_ID}" ships ${made[0].animator.available.length} clip(s) ` +
            `(${made[0].animator.available.join(', ')}) and none match a movement state. ` +
            `Every state will play the same clip. Missing: ${coverage.missing.join(', ')}`,
        );
      }
    }

    return () => {
      for (const slot of made) {
        slot.animator.dispose();
        group.remove(slot.root);
        for (const material of slot.teamMaterials) material.dispose();
        slot.accent?.dispose();
      }
      slots.current = [];
    };
  }, [character]);

  // Attach a weapon to each avatar's right hand, once both assets exist.
  useEffect(() => {
    if (!weapon || slots.current.length === 0) return;
    const attached: THREE.Object3D[] = [];
    for (const slot of slots.current) {
      let socket: THREE.Object3D | null = null;
      slot.root.traverse((node) => {
        if (node.name === 'SOCKET_weapon_right' || node.name === 'weapon_right') socket = node;
      });
      if (!socket) continue;
      const gun = weapon.scene.clone(true);
      // Sockets are hidden by the importer, so anything parented to one inherits that. Re-show.
      (socket as THREE.Object3D).visible = true;
      (socket as THREE.Object3D).add(gun);
      attached.push(gun);
      gun.traverse((node) => {
        if (node.name === 'SOCKET_muzzle' || node.name === 'muzzle') slot.muzzle = node;
      });
    }
    return () => {
      for (const gun of attached) gun.parent?.remove(gun);
      for (const slot of slots.current) slot.muzzle = null;
    };
  }, [weapon, character]);

  useFrame((_, delta) => {
    const pool = slots.current;
    if (pool.length === 0 || !game.match) return;

    const actors = [...game.match.state.actors.values()].filter((a) => a.kind !== 'local' && a.alive);
    const alpha = game.alpha;

    // Release slots whose actor has gone, so a departing player does not leave a body standing.
    const live = new Set(actors.map((a) => a.id));
    for (const slot of pool) {
      if (slot.actorId !== null && !live.has(slot.actorId)) {
        clearMuzzle(slot.actorId);
        // Drop the mapper's per-actor memory too, or a rejoining player inherits the tier, hold and
        // turn state of whoever last used the id — and the map grows for the life of the session.
        characterStates.release(slot.actorId);
        slot.actorId = null;
        slot.root.visible = false;
      }
    }

    let next = 0;
    for (const actor of actors) {
      // Keep an actor on the slot it already had, so its animation phase does not restart.
      let slot = pool.find((s) => s.actorId === actor.id);
      if (!slot) {
        while (next < pool.length && pool[next].actorId !== null) next++;
        if (next >= pool.length) break;
        slot = pool[next];
        slot.actorId = actor.id;
        slot.lastState = '';
      }

      slot.root.visible = true;
      // footOffset lands the mesh's feet on the actor's origin. See the manifest
      // entry: it is a measured property of the rig's bind pose, not a fudge, and
      // it must not be folded into the simulation — the actor's position is
      // authoritative and this is purely how the mesh is hung off it.
      const footOffset = character?.entry.footOffset ?? 0;
      slot.root.position.set(
        lerp(actor.prevPosition.x, actor.position.x, alpha),
        lerp(actor.prevPosition.y, actor.position.y, alpha) + footOffset,
        lerp(actor.prevPosition.z, actor.position.z, alpha),
      );
      // The engine's yaw 0 faces -z and so does a glTF character authored to convention, so the
      // rotation is applied directly. An asset that faces +Z needs a 180 degree correction in its
      // manifest entry rather than here — see `AssetEntry.yawOffset`.
      slot.root.rotation.set(0, actor.yaw + (character?.entry.yawOffset ?? 0), 0);

      const decision = characterStates.resolve(actor, delta);
      // Turn direction is part of the key: a left turn followed by a right turn is two different
      // clips, and keying on the state name alone would leave the first one playing.
      const key = decision.state === 'turning' ? `turning${decision.turnSign}` : decision.state;
      if (key !== slot.lastState) {
        const clip =
          decision.state === 'turning'
            ? turnClipFor(slot.animator, decision.turnSign)
            : clipFor(slot.animator, decision.state);
        // `once` states are events with a known duration — the mapper holds them and decides what
        // follows, so they are played held rather than looped. See AssetAnimator.playHeld.
        if (clip) {
          if (decision.once) slot.animator.playHeld(clip);
          else slot.animator.play(clip);
        }
        slot.lastState = key;
      }
      slot.animator.update(delta);

      // Write colour where the material has it and emissive only where it exists. Basic materials
      // carry no emissive channel and are already unlit, so their colour *is* the glow.
      const emissive = teamEmissive(actor.team, colorblind);
      for (const material of slot.teamMaterials) {
        const tinted = material as THREE.MeshStandardMaterial;
        tinted.color?.setHex(emissive);
        tinted.emissive?.setHex(emissive);
      }
      // The head accent takes team colour too, so a glance at the face reads as
      // friend or enemy before the body does.
      slot.accent?.color.setHex(emissive);
      // Follows the head's position every frame. The skeleton has already been
      // posed by the mixer above, so the socket's world position is current.
      if (slot.accentNode && slot.accentSocket) {
        slot.root.updateMatrixWorld(true);
        placeHeadAccent(slot.accentNode, slot.accentSocket, slot.root);
      }

      // Third-person muzzle. This is what makes R1's correction exact for remote players instead of
      // estimated: once a real weapon hangs off a real hand bone, its socket is the truth.
      if (slot.muzzle) {
        slot.muzzle.getWorldPosition(worldPosition);
        publishMuzzle(actor.id, worldPosition);
      }
    }
  });

  return <group ref={groupRef} name="asset-avatars" />;
}
