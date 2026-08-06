import * as THREE from 'three';
import type { Actor } from '@/gameplay/types';

/**
 * Where each actor's weapon muzzle currently is, in world space, for **presentation only**.
 *
 * ## The problem this exists to solve
 *
 * The simulation spawns a bolt at `eyePosition + aim × 0.42 − 0.14` in Y. That origin is
 * authoritative: it decides what the bolt collides with, it is replicated, and it is re-simulated
 * during lag compensation. It is also **not where the weapon is**. Measured live, the visible
 * `SOCKET_muzzle` sat **0.442 m** from the simulated origin — 0.21 m lateral, 0.39 m forward — so
 * bolts appeared to leave a point behind and inboard of the barrel.
 *
 * The fix is not to move the simulation. Reading a Three.js transform inside `WeaponSystem` would
 * put presentation in the deterministic path, make the origin depend on whether a client had
 * finished loading its view model, and desynchronise prediction from the server. The rule this
 * project has held since M1 is that the simulation imports nothing from the renderer, and a cosmetic
 * misalignment is not a good enough reason to break it.
 *
 * So the *renderer* corrects it. The bolt is drawn from the muzzle and converges onto the
 * authoritative path over its first few metres — which is what shooters normally do, because the
 * visual tracer and the authoritative ray have always been different objects.
 *
 * ## Two sources, one interface
 *
 * The local player has a real view model with a real `SOCKET_muzzle`, so `publish` records its exact
 * world position each frame. Remote players are drawn by `PlayerAvatars`, which has no weapon mesh
 * at all — their right arm tracks aim but carries nothing — so there is no socket to read and the
 * position is estimated from the actor's own transform instead.
 *
 * An estimate is worth having. It puts the bolt at the shooter's hand rather than at their sternum,
 * which is the difference a spectator actually notices.
 */

/** Metres over which the visual origin blends back onto the simulated path. */
export const MUZZLE_CONVERGE = 3.0;

/**
 * Lateral, forward and vertical offsets of a remote player's weapon hand from their eye.
 *
 * Matched to `PlayerAvatars`' right-arm placement: the arm hangs at +0.36 in torso space and swings
 * forward with pitch. These are deliberately not the simulation's `MUZZLE_FORWARD` / `MUZZLE_DOWN`
 * constants — the whole point is that the two differ, and pinning them together in code would hide
 * the very discrepancy this file corrects.
 */
const HAND_RIGHT = 0.26;
const HAND_FORWARD = 0.62;
const HAND_DOWN = 0.22;

const published = new Map<number, THREE.Vector3>();
const scratch = new THREE.Vector3();

/**
 * Records an actor's true muzzle position for this frame.
 *
 * Called by whatever is actually drawing that actor's weapon. Values are per-frame and are expected
 * to be republished continuously; nothing here interpolates or persists across a match.
 */
export function publishMuzzle(actorId: number, world: THREE.Vector3): void {
  const existing = published.get(actorId);
  if (existing) existing.copy(world);
  else published.set(actorId, world.clone());
}

/** Forgets an actor, when their view model unmounts or they leave. */
export function clearMuzzle(actorId: number): void {
  published.delete(actorId);
}

/**
 * The best available muzzle position for an actor.
 *
 * Returns the published socket position when one exists, and otherwise estimates from the actor's
 * transform. Writes into `out` and returns it.
 */
export function muzzleFor(actor: Actor, out: THREE.Vector3): THREE.Vector3 {
  const exact = published.get(actor.id);
  if (exact) return out.copy(exact);

  // Engine convention: yaw 0 faces -z, so forward is (-sin yaw, ·, -cos yaw) and the right-hand
  // vector is its yaw-plane perpendicular. Getting this backwards puts every remote player's bolts
  // on the wrong side of their body, which is subtle enough to ship and obvious once seen.
  const cos = Math.cos(actor.pitch);
  const fx = -Math.sin(actor.yaw) * cos;
  const fy = Math.sin(actor.pitch);
  const fz = -Math.cos(actor.yaw) * cos;
  const rx = Math.cos(actor.yaw);
  const rz = -Math.sin(actor.yaw);

  // Eye height matches `eyePosition` in MovementSystem: top of the capsule less the eye offset.
  const eyeY = actor.position.y + actor.height - 0.12;
  return out.set(
    actor.position.x + rx * HAND_RIGHT + fx * HAND_FORWARD,
    eyeY + fy * HAND_FORWARD - HAND_DOWN,
    actor.position.z + rz * HAND_RIGHT + fz * HAND_FORWARD,
  );
}

/**
 * The offset to add to a bolt's drawn position so it appears to leave the barrel.
 *
 * Stateless, which matters: projectiles are pooled and the renderer may first see one several ticks
 * after it spawned, so anything that had to be recorded at spawn time would be unreliable. The
 * spawn point is recoverable instead — a bolt travels in a straight line, so
 * `origin = position − direction × distanceTravelled` regardless of when it is first observed.
 *
 * The offset decays to zero over `MUZZLE_CONVERGE` metres, so the bolt starts at the muzzle and is
 * exactly on the authoritative path by the time it is anywhere near a target. Nothing about hit
 * detection changes; only the pixels move.
 */
export function muzzleOffset(
  actor: Actor | undefined,
  position: { x: number; y: number; z: number },
  direction: THREE.Vector3,
  distanceTravelled: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  out.set(0, 0, 0);
  if (!actor) return out;

  const blend = 1 - Math.min(1, distanceTravelled / MUZZLE_CONVERGE);
  if (blend <= 0) return out;

  muzzleFor(actor, scratch);
  // Reconstruct where the simulation actually spawned it, then take the muzzle's offset from that.
  out.set(
    scratch.x - (position.x - direction.x * distanceTravelled),
    scratch.y - (position.y - direction.y * distanceTravelled),
    scratch.z - (position.z - direction.z * distanceTravelled),
  );
  return out.multiplyScalar(blend);
}

/** Test seam: drops every published muzzle. */
export function resetMuzzles(): void {
  published.clear();
}
