import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MUZZLE_CONVERGE,
  clearMuzzle,
  muzzleFor,
  muzzleOffset,
  publishMuzzle,
  resetMuzzles,
} from '@/render/MuzzleRegistry';
import type { Actor } from '@/gameplay/types';

/**
 * R1: bolts must appear to leave the barrel.
 *
 * Measured live before this existed, the visible `SOCKET_muzzle` sat 0.442 m from the point the
 * simulation spawned a bolt — 0.21 m lateral, 0.39 m forward. The correction is presentation-only,
 * so these tests are about two properties and nothing else:
 *
 *   1. a bolt starts drawn at the muzzle;
 *   2. it is exactly on the authoritative path by the convergence distance, so nothing about aiming,
 *      hit detection or replication can be affected by it.
 */

function actorAt(x: number, y: number, z: number, yaw = 0, pitch = 0): Actor {
  return {
    id: 7,
    position: { x, y, z },
    height: 1.8,
    yaw,
    pitch,
  } as unknown as Actor;
}

const out = new THREE.Vector3();

beforeEach(() => resetMuzzles());

describe('muzzle registry', () => {
  it('returns a published socket position exactly', () => {
    publishMuzzle(7, new THREE.Vector3(1, 2, 3));
    muzzleFor(actorAt(0, 0, 0), out);
    expect([out.x, out.y, out.z]).toEqual([1, 2, 3]);
  });

  it('copies rather than aliasing the published vector', () => {
    const source = new THREE.Vector3(1, 2, 3);
    publishMuzzle(7, source);
    source.set(9, 9, 9);
    muzzleFor(actorAt(0, 0, 0), out);
    // A retained reference would let the caller's scratch vector rewrite the registry every frame.
    expect(out.x).toBe(1);
  });

  it('forgets a cleared actor and falls back to the estimate', () => {
    publishMuzzle(7, new THREE.Vector3(50, 50, 50));
    clearMuzzle(7);
    muzzleFor(actorAt(0, 0, 0), out);
    expect(out.length()).toBeLessThan(5);
  });

  it('estimates a remote muzzle forward and to the shooter right', () => {
    // Yaw 0 faces -z, so forward is -z and the right hand is +x.
    muzzleFor(actorAt(0, 0, 0, 0), out);
    expect(out.z).toBeLessThan(0);
    expect(out.x).toBeGreaterThan(0);
    // Roughly eye height, a little below.
    expect(out.y).toBeGreaterThan(1.2);
    expect(out.y).toBeLessThan(1.7);
  });

  it('rotates the estimate with the shooter', () => {
    muzzleFor(actorAt(0, 0, 0, Math.PI / 2), out);
    // Yawed 90 degrees: forward becomes -x, so the muzzle leads in -x.
    expect(out.x).toBeLessThan(0);
    expect(Math.abs(out.z)).toBeLessThan(0.4);
  });
});

describe('muzzle offset', () => {
  const direction = new THREE.Vector3(0, 0, -1);

  it('places a freshly spawned bolt at the muzzle', () => {
    const actor = actorAt(0, 0, 0);
    publishMuzzle(7, new THREE.Vector3(0.3, 1.5, -0.6));

    // A bolt that has travelled nothing yet sits at the simulated origin.
    const simOrigin = { x: 0, y: 1.56, z: -0.42 };
    muzzleOffset(actor, simOrigin, direction, 0, out);

    expect(simOrigin.x + out.x).toBeCloseTo(0.3, 5);
    expect(simOrigin.y + out.y).toBeCloseTo(1.5, 5);
    expect(simOrigin.z + out.z).toBeCloseTo(-0.6, 5);
  });

  it('reconstructs the spawn point from a bolt already in flight', () => {
    const actor = actorAt(0, 0, 0);
    publishMuzzle(7, new THREE.Vector3(0.3, 1.5, -0.6));

    // Same shot, observed 1 m later. The offset must be measured from where it *started*, not from
    // where it is now — projectiles are pooled and the renderer may first see one several ticks in.
    const travelled = 1;
    const position = { x: 0, y: 1.56, z: -0.42 - travelled };
    muzzleOffset(actor, position, direction, travelled, out);

    const blend = 1 - travelled / MUZZLE_CONVERGE;
    expect(out.x).toBeCloseTo(0.3 * blend, 5);
    expect(out.z).toBeCloseTo(-0.18 * blend, 5);
  });

  it('decays to nothing by the convergence distance', () => {
    const actor = actorAt(0, 0, 0);
    publishMuzzle(7, new THREE.Vector3(5, 5, 5));
    muzzleOffset(actor, { x: 0, y: 0, z: 0 }, direction, MUZZLE_CONVERGE, out);
    expect(out.length()).toBe(0);
  });

  it('stays at zero beyond the convergence distance', () => {
    const actor = actorAt(0, 0, 0);
    publishMuzzle(7, new THREE.Vector3(5, 5, 5));
    muzzleOffset(actor, { x: 0, y: 0, z: 0 }, direction, 500, out);
    expect(out.length()).toBe(0);
  });

  it('decreases monotonically along the flight', () => {
    const actor = actorAt(0, 0, 0);
    publishMuzzle(7, new THREE.Vector3(0.3, 1.5, -0.6));
    let previous = Infinity;
    for (let d = 0; d <= MUZZLE_CONVERGE; d += 0.25) {
      muzzleOffset(actor, { x: 0, y: 1.56, z: -0.42 - d }, direction, d, out);
      const length = out.length();
      expect(length).toBeLessThanOrEqual(previous + 1e-9);
      previous = length;
    }
    expect(previous).toBe(0);
  });

  it('is a no-op when the shooter is unknown', () => {
    // A bolt whose owner has already left. Must degrade to the previous behaviour, not to a guess.
    muzzleOffset(undefined, { x: 0, y: 0, z: 0 }, direction, 0, out);
    expect(out.length()).toBe(0);
  });
});
