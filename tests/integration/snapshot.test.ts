import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot, SnapshotHistory, type WorldSnapshot } from '@/net/snapshot';
import { ACTOR_FLAG } from '@/net/protocol';

/**
 * Delta-compression behaviour, tested without needing a physics world or a server.
 *
 * These lock in the properties the replication layer promises: a delta must be smaller than a full
 * snapshot, an unchanged actor must cost almost nothing, a departed actor must actually disappear,
 * and a delta whose baseline has been evicted must be refused rather than half-applied.
 */

const actor = (id: number, x: number, z: number) => ({
  id,
  team: 'red' as const,
  px: x,
  py: 0,
  pz: z,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: 0,
  pitch: 0,
  lean: 0,
  stance: 'stand' as const,
  height: 1.8,
  health: 100,
  shield: 60,
  charge: 6,
  rechargeProgress: 1,
  flags: ACTOR_FLAG.ALIVE,
  score: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
});

const world = (tick: number, actors: ReturnType<typeof actor>[]): WorldSnapshot => ({
  tick,
  time: tick / 64,
  phase: 1,
  timeRemaining: 600,
  scores: { red: 0, blue: 0 },
  actors: new Map(actors.map((a) => [a.id, a])),
});

describe('snapshot delta compression', () => {
  it('round-trips a full snapshot losslessly within quantisation', () => {
    const history = new SnapshotHistory();
    const snap = world(100, [actor(1, 12.5, -8.25), actor(2, -3.125, 20)]);
    history.push(snap);

    const decoded = decodeSnapshot(encodeSnapshot(snap, null), history);
    expect(decoded).not.toBeNull();
    expect(decoded!.baselineMissing).toBe(false);
    expect(decoded!.snapshot.actors.size).toBe(2);
    expect(decoded!.snapshot.actors.get(1)!.px).toBeCloseTo(12.5, 2);
    expect(decoded!.snapshot.actors.get(2)!.pz).toBeCloseTo(20, 2);
  });

  it('produces a smaller delta than a full snapshot', () => {
    const base = world(100, [actor(1, 0, 0), actor(2, 5, 5), actor(3, -5, -5)]);
    const next = world(101, [actor(1, 0.2, 0), actor(2, 5, 5), actor(3, -5, -5)]);
    expect(encodeSnapshot(next, base).byteLength).toBeLessThan(
      encodeSnapshot(next, null).byteLength,
    );
  });

  it('costs almost nothing when nothing changed', () => {
    const base = world(100, [actor(1, 0, 0), actor(2, 5, 5)]);
    const same = world(101, [actor(1, 0, 0), actor(2, 5, 5)]);
    // Header, scores and per-actor masks only — no field payloads.
    expect(encodeSnapshot(same, base).byteLength).toBeLessThan(40);
  });

  it('removes actors that left', () => {
    const history = new SnapshotHistory();
    const base = world(100, [actor(1, 0, 0), actor(2, 5, 5)]);
    history.push(base);
    const next = world(101, [actor(1, 0, 0)]);
    history.push(next);

    const decoded = decodeSnapshot(encodeSnapshot(next, base), history);
    expect(decoded!.snapshot.actors.has(2)).toBe(false);
    expect(decoded!.snapshot.actors.has(1)).toBe(true);
  });

  it('reports a missing baseline instead of applying a partial world', () => {
    const history = new SnapshotHistory();
    const base = world(100, [actor(1, 0, 0)]);
    const next = world(101, [actor(1, 1, 1)]);
    // The encoder references tick 100, but the receiver never stored it.
    const decoded = decodeSnapshot(encodeSnapshot(next, base), history);
    expect(decoded!.baselineMissing).toBe(true);
  });
});

describe('SnapshotHistory', () => {
  it('finds the newest snapshot at or before a tick, for lag-compensation rewind', () => {
    const history = new SnapshotHistory();
    for (const tick of [10, 20, 30, 40]) history.push(world(tick, [actor(1, tick, 0)]));
    expect(history.atOrBefore(35)!.tick).toBe(30);
    expect(history.atOrBefore(40)!.tick).toBe(40);
    expect(history.atOrBefore(5)).toBeNull();
  });

  it('brackets a tick for interpolation', () => {
    const history = new SnapshotHistory();
    for (const tick of [10, 20, 30]) history.push(world(tick, [actor(1, tick, 0)]));
    const { from, to } = history.bracket(15);
    expect(from!.tick).toBe(10);
    expect(to!.tick).toBe(20);
  });

  it('evicts oldest entries once capacity is exceeded', () => {
    const history = new SnapshotHistory(4);
    for (const tick of [1, 2, 3, 4, 5, 6]) history.push(world(tick, [actor(1, 0, 0)]));
    expect(history.get(1)).toBeNull();
    expect(history.get(6)).not.toBeNull();
    expect(history.latest!.tick).toBe(6);
  });
});
