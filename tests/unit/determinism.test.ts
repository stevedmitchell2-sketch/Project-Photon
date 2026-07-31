import { describe, expect, it } from 'vitest';
import { Rng } from '@/util/rng';
import { angleDelta, applyDeadzone, clamp, forwardFromLook, groundBasis } from '@/util/math';

/**
 * The simulation's determinism guarantees, tested directly.
 *
 * Client prediction replays inputs on top of authoritative state and expects bit-identical results.
 * Every property here is load-bearing for that: if the RNG diverges or the look/basis maths is
 * inconsistent, prediction silently disagrees with the server on every snapshot.
 */

describe('Rng', () => {
  it('produces identical sequences from identical seeds', () => {
    const a = new Rng(1337);
    const b = new Rng(1337);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('produces different sequences from different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const aVals = Array.from({ length: 32 }, () => a.next());
    const bVals = Array.from({ length: 32 }, () => b.next());
    expect(aVals).not.toEqual(bVals);
  });

  it('stays within [0, 1)', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 5000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('restores an identical stream from a serialized state', () => {
    // Rollback must rewind randomness along with everything else.
    const rng = new Rng(7);
    for (let i = 0; i < 50; i++) rng.next();
    const saved = rng.serialize();
    const expected = Array.from({ length: 20 }, () => rng.next());

    const restored = new Rng(0);
    restored.deserialize(saved);
    expect(Array.from({ length: 20 }, () => restored.next())).toEqual(expected);
  });

  it('spreads roughly evenly across the unit interval', () => {
    const rng = new Rng(4242);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) buckets[Math.floor(rng.next() * 10)]++;
    // A grossly biased generator would show up immediately; this is a smoke test, not a chi-square.
    for (const count of buckets) expect(count).toBeGreaterThan(1400);
  });
});

describe('look and movement basis', () => {
  it('yaw 0 looks down -Z', () => {
    const f = forwardFromLook(0, 0);
    expect(f.x).toBeCloseTo(0, 6);
    expect(f.z).toBeCloseTo(-1, 6);
  });

  it('agrees with the spawn-facing convention atan2(x, z)', () => {
    // Spawn yaws are authored as `atan2(x, z)` to face the arena centre from (x, z). Getting this
    // backwards pointed every spawn at the wall behind it — a real bug that shipped for two phases.
    for (const [x, z] of [
      [-25, -25],
      [25, 25],
      [-25, 25],
      [25, -25],
    ]) {
      const yaw = Math.atan2(x, z);
      const f = forwardFromLook(yaw, 0);
      // Forward must point from (x, z) toward the origin.
      const len = Math.hypot(x, z);
      expect(f.x).toBeCloseTo(-x / len, 5);
      expect(f.z).toBeCloseTo(-z / len, 5);
    }
  });

  it('groundBasis forward matches forwardFromLook at zero pitch', () => {
    for (const yaw of [0, 0.5, -1.2, Math.PI, -Math.PI / 2]) {
      const f = forwardFromLook(yaw, 0);
      const b = groundBasis(yaw);
      expect(b.fx).toBeCloseTo(f.x, 6);
      expect(b.fz).toBeCloseTo(f.z, 6);
    }
  });

  it('groundBasis right is perpendicular to forward', () => {
    for (const yaw of [0, 0.9, -2.4, 3.0]) {
      const b = groundBasis(yaw);
      expect(b.fx * b.rx + b.fz * b.rz).toBeCloseTo(0, 6);
    }
  });
});

describe('angleDelta', () => {
  it('takes the short way around the +-PI boundary', () => {
    // Interpolating the long way makes a player crossing PI spin 350 degrees.
    expect(angleDelta(3.1, -3.1)).toBeCloseTo(0.0832, 3);
    expect(angleDelta(-3.1, 3.1)).toBeCloseTo(-0.0832, 3);
  });

  it('returns a value in (-PI, PI]', () => {
    for (let i = 0; i < 200; i++) {
      const from = (i / 200) * 20 - 10;
      const to = ((i * 7) % 200) / 200 * 20 - 10;
      const d = angleDelta(from, to);
      expect(d).toBeGreaterThan(-Math.PI - 1e-9);
      expect(d).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe('input conditioning', () => {
  it('applyDeadzone zeroes inside the deadzone and rescales outside it', () => {
    expect(applyDeadzone(0.05, 0, 0.15)).toEqual([0, 0]);
    const [x] = applyDeadzone(1, 0, 0.15);
    // Full deflection must still reach full range after rescaling.
    expect(x).toBeCloseTo(1, 5);
  });

  it('clamp bounds correctly', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
