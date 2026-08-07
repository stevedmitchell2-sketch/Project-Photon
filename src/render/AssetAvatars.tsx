import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AssetAnimator, clipFor } from '@/assets/AssetAnimator';
import { useAsset } from '@/assets/useAsset';
import { teamEmissive } from '@/config/teams';
import type { Actor } from '@/gameplay/types';
import { lerp } from '@/util/math';
import { useGame } from './GameContext';
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
 * Maps simulation state onto an animation state name.
 *
 * Reads the same actor fields the blockout's pose function reads, so the two paths cannot disagree
 * about what a player is doing — only about how it looks. Resolution from this name to an actual
 * clip is `clipFor`, which lets an asset ship `run`, `run_forward` or `sprint` and still work.
 */
function movementState(actor: Actor): string {
  if (!actor.alive) return 'death';
  if (!actor.grounded) return actor.velocity.y > 0.5 ? 'jump' : 'fall';
  if (actor.stance === 'slide') return 'slide';
  if (actor.stance === 'crouch') return 'crouch';
  const speed = Math.hypot(actor.velocity.x, actor.velocity.z);
  if (speed > 6) return 'run';
  if (speed > 0.35) return 'walk';
  return 'idle';
}

interface Slot {
  root: THREE.Group;
  animator: AssetAnimator;
  /** The weapon's muzzle socket, when a weapon was attached. */
  muzzle: THREE.Object3D | null;
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

      made.push({
        root,
        animator: new AssetAnimator({ ...character, scene: root }),
        muzzle: null,
        teamMaterials,
        actorId: null,
        lastState: '',
      });
    }
    slots.current = made;

    return () => {
      for (const slot of made) {
        slot.animator.dispose();
        group.remove(slot.root);
        for (const material of slot.teamMaterials) material.dispose();
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

      const state = movementState(actor);
      if (state !== slot.lastState) {
        const clip = clipFor(slot.animator, state);
        if (clip) slot.animator.play(clip);
        slot.lastState = state;
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
