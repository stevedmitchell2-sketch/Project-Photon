import { TEAM_IDS, type TeamId } from '@/config/teams';
import type { Actor, MatchState, Stance } from '@/gameplay/types';
import { ByteReader, ByteWriter } from './serialize';
import { ACTOR_FIELDS, ACTOR_FLAG, SNAPSHOT_HISTORY } from './protocol';

/**
 * The replicated projection of an actor.
 *
 * Deliberately a *subset* of Actor. Things the client can derive (view bob, stride distance, damage
 * contributions, physics handles) are never sent; things the client must not author (health, score)
 * always are. Keeping this struct separate from Actor is what stops presentation state from
 * accidentally becoming part of the wire format.
 */
export interface ActorSnapshot {
  id: number;
  team: TeamId;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  lean: number;
  stance: Stance;
  height: number;
  health: number;
  shield: number;
  charge: number;
  rechargeProgress: number;
  flags: number;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
}

export interface WorldSnapshot {
  /** Server tick this snapshot describes. */
  tick: number;
  /** Server time in seconds, for clock sync. */
  time: number;
  phase: number;
  timeRemaining: number;
  scores: Record<string, number>;
  actors: Map<number, ActorSnapshot>;
}

const STANCES: Stance[] = ['stand', 'crouch', 'slide'];

export function captureActor(actor: Actor): ActorSnapshot {
  let flags = 0;
  if (actor.alive) flags |= ACTOR_FLAG.ALIVE;
  if (actor.grounded) flags |= ACTOR_FLAG.GROUNDED;
  if (actor.weapon.recharging) flags |= ACTOR_FLAG.RECHARGING;
  if (actor.spawnProtection > 0) flags |= ACTOR_FLAG.SPAWN_PROTECTED;
  if (actor.fx.firedThisTick) flags |= ACTOR_FLAG.FIRED_THIS_TICK;

  return {
    id: actor.id,
    team: actor.team,
    px: actor.position.x,
    py: actor.position.y,
    pz: actor.position.z,
    vx: actor.velocity.x,
    vy: actor.velocity.y,
    vz: actor.velocity.z,
    yaw: actor.yaw,
    pitch: actor.pitch,
    lean: actor.lean,
    stance: actor.stance,
    height: actor.height,
    health: actor.health,
    shield: actor.shield,
    charge: actor.weapon.charge,
    rechargeProgress: actor.weapon.rechargeProgress,
    flags,
    score: actor.score,
    kills: actor.kills,
    deaths: actor.deaths,
    assists: actor.assists,
  };
}

export function captureWorld(state: MatchState): WorldSnapshot {
  const actors = new Map<number, ActorSnapshot>();
  for (const actor of state.actors.values()) actors.set(actor.id, captureActor(actor));
  return {
    tick: state.tick,
    time: state.time,
    phase: state.phase === 'warmup' ? 0 : state.phase === 'active' ? 1 : 2,
    timeRemaining: state.timeRemaining,
    scores: { ...state.scores },
    actors,
  };
}

/**
 * Applies a snapshot onto a local actor. Used both when a remote actor updates and when the local
 * player is rewound for reconciliation.
 *
 * `authoritative` controls whether look angles are overwritten. For the local player they must not
 * be: the client owns its own aim, and snapping it back on every snapshot produces the classic
 * "camera fights the mouse" feel. The server still validates aim, it just does not dictate it.
 */
export function applyActorSnapshot(actor: Actor, snap: ActorSnapshot, authoritative: boolean): void {
  actor.position.x = snap.px;
  actor.position.y = snap.py;
  actor.position.z = snap.pz;
  actor.velocity.x = snap.vx;
  actor.velocity.y = snap.vy;
  actor.velocity.z = snap.vz;
  actor.lean = snap.lean;
  actor.stance = snap.stance;
  actor.height = snap.height;
  actor.health = snap.health;
  actor.shield = snap.shield;
  actor.weapon.charge = snap.charge;
  actor.weapon.rechargeProgress = snap.rechargeProgress;
  actor.weapon.recharging = (snap.flags & ACTOR_FLAG.RECHARGING) !== 0;
  actor.alive = (snap.flags & ACTOR_FLAG.ALIVE) !== 0;
  actor.grounded = (snap.flags & ACTOR_FLAG.GROUNDED) !== 0;
  actor.spawnProtection = (snap.flags & ACTOR_FLAG.SPAWN_PROTECTED) !== 0 ? 0.1 : 0;
  actor.team = snap.team;
  actor.score = snap.score;
  actor.kills = snap.kills;
  actor.deaths = snap.deaths;
  actor.assists = snap.assists;

  if (authoritative) {
    actor.yaw = snap.yaw;
    actor.pitch = snap.pitch;
  }
}

// --- Encoding ----------------------------------------------------------------

/** Fields that differ between two actor snapshots, as an ACTOR_FIELDS mask. */
function diffMask(prev: ActorSnapshot | undefined, next: ActorSnapshot): number {
  if (!prev) return 0xffff;
  let mask = 0;
  if (prev.px !== next.px || prev.py !== next.py || prev.pz !== next.pz) mask |= ACTOR_FIELDS.POSITION;
  if (prev.vx !== next.vx || prev.vy !== next.vy || prev.vz !== next.vz) mask |= ACTOR_FIELDS.VELOCITY;
  if (prev.yaw !== next.yaw) mask |= ACTOR_FIELDS.YAW;
  if (prev.pitch !== next.pitch) mask |= ACTOR_FIELDS.PITCH;
  if (prev.stance !== next.stance || prev.height !== next.height) mask |= ACTOR_FIELDS.STANCE;
  if (prev.health !== next.health) mask |= ACTOR_FIELDS.HEALTH;
  if (prev.shield !== next.shield) mask |= ACTOR_FIELDS.SHIELD;
  if (prev.charge !== next.charge || prev.rechargeProgress !== next.rechargeProgress) {
    mask |= ACTOR_FIELDS.WEAPON;
  }
  if (prev.flags !== next.flags) mask |= ACTOR_FIELDS.FLAGS;
  if (
    prev.score !== next.score ||
    prev.kills !== next.kills ||
    prev.deaths !== next.deaths ||
    prev.assists !== next.assists
  ) {
    mask |= ACTOR_FIELDS.SCORE;
  }
  if (prev.team !== next.team) mask |= ACTOR_FIELDS.TEAM;
  if (prev.lean !== next.lean) mask |= ACTOR_FIELDS.LEAN;
  return mask;
}

/**
 * Encodes `next` as a delta against `baseline`. Pass `null` for a full snapshot.
 *
 * Actors absent from `next` but present in the baseline are explicitly marked as removed, so a
 * client can never be left rendering a player who disconnected.
 */
export function encodeSnapshot(
  next: WorldSnapshot,
  baseline: WorldSnapshot | null,
  writer = new ByteWriter(2048),
): Uint8Array {
  writer.varint(next.tick);
  writer.f32(next.time);
  writer.u8(next.phase);
  writer.u16(Math.max(0, Math.round(next.timeRemaining)));
  writer.varint(baseline ? baseline.tick : 0);

  // Scores, keyed by team index so the key itself costs one byte.
  const scoreKeys = Object.keys(next.scores);
  writer.u8(scoreKeys.length);
  for (const key of scoreKeys) {
    const teamIndex = TEAM_IDS.indexOf(key as TeamId);
    // Free-for-all uses actor ids as keys, which do not index into TEAM_IDS.
    writer.u8(teamIndex >= 0 ? teamIndex : 0xff);
    if (teamIndex < 0) writer.varint(Number(key) || 0);
    writer.varint(Math.max(0, next.scores[key]));
  }

  const removed: number[] = [];
  if (baseline) {
    for (const id of baseline.actors.keys()) {
      if (!next.actors.has(id)) removed.push(id);
    }
  }
  writer.u8(removed.length);
  for (const id of removed) writer.varint(id);

  writer.u8(next.actors.size);
  for (const [id, snap] of next.actors) {
    const prev = baseline?.actors.get(id);
    const mask = diffMask(prev, snap);
    writer.varint(id);
    writer.u16(mask);
    if (mask === 0) continue;

    if (mask & ACTOR_FIELDS.TEAM) writer.u8(TEAM_IDS.indexOf(snap.team));
    if (mask & ACTOR_FIELDS.POSITION) {
      writer.position(snap.px);
      writer.position(snap.py);
      writer.position(snap.pz);
    }
    if (mask & ACTOR_FIELDS.VELOCITY) {
      writer.velocity(snap.vx);
      writer.velocity(snap.vy);
      writer.velocity(snap.vz);
    }
    if (mask & ACTOR_FIELDS.YAW) writer.angle(snap.yaw);
    if (mask & ACTOR_FIELDS.PITCH) writer.angle(snap.pitch);
    if (mask & ACTOR_FIELDS.LEAN) writer.i16(snap.lean * 1000);
    if (mask & ACTOR_FIELDS.STANCE) {
      writer.u8(STANCES.indexOf(snap.stance));
      writer.u8(Math.round(snap.height * 100));
    }
    if (mask & ACTOR_FIELDS.HEALTH) writer.u8(Math.max(0, Math.round(snap.health)));
    if (mask & ACTOR_FIELDS.SHIELD) writer.u8(Math.max(0, Math.round(snap.shield)));
    if (mask & ACTOR_FIELDS.WEAPON) {
      writer.u8(Math.round(snap.charge));
      writer.u8(Math.round(snap.rechargeProgress * 255));
    }
    if (mask & ACTOR_FIELDS.FLAGS) writer.u8(snap.flags);
    if (mask & ACTOR_FIELDS.SCORE) {
      writer.varint(Math.max(0, snap.score));
      writer.varint(snap.kills);
      writer.varint(snap.deaths);
      writer.varint(snap.assists);
    }
  }

  return writer.finish();
}

/**
 * Decodes a snapshot, filling unspecified fields from `baseline`.
 *
 * Returns null when the delta references a baseline the client no longer holds — the caller then
 * requests a full snapshot rather than applying a partially-known state.
 */
export function decodeSnapshot(
  bytes: Uint8Array,
  history: SnapshotHistory,
): { snapshot: WorldSnapshot; baselineMissing: boolean } | null {
  const reader = new ByteReader(bytes);
  const tick = reader.varint();
  const time = reader.f32();
  const phase = reader.u8();
  const timeRemaining = reader.u16();
  const baselineTick = reader.varint();

  const baseline = baselineTick === 0 ? null : history.get(baselineTick);
  if (baselineTick !== 0 && !baseline) {
    return { snapshot: emptySnapshot(tick, time), baselineMissing: true };
  }

  const scores: Record<string, number> = {};
  const scoreCount = reader.u8();
  for (let i = 0; i < scoreCount; i++) {
    const teamIndex = reader.u8();
    const key = teamIndex === 0xff ? String(reader.varint()) : TEAM_IDS[teamIndex];
    scores[key] = reader.varint();
  }

  const actors = new Map<number, ActorSnapshot>();
  if (baseline) {
    for (const [id, snap] of baseline.actors) actors.set(id, { ...snap });
  }

  const removedCount = reader.u8();
  for (let i = 0; i < removedCount; i++) actors.delete(reader.varint());

  const actorCount = reader.u8();
  for (let i = 0; i < actorCount; i++) {
    const id = reader.varint();
    const mask = reader.u16();
    const existing = actors.get(id);
    const snap: ActorSnapshot = existing ? { ...existing } : blankActor(id);

    if (mask & ACTOR_FIELDS.TEAM) snap.team = TEAM_IDS[reader.u8()] ?? 'red';
    if (mask & ACTOR_FIELDS.POSITION) {
      snap.px = reader.position();
      snap.py = reader.position();
      snap.pz = reader.position();
    }
    if (mask & ACTOR_FIELDS.VELOCITY) {
      snap.vx = reader.velocity();
      snap.vy = reader.velocity();
      snap.vz = reader.velocity();
    }
    if (mask & ACTOR_FIELDS.YAW) snap.yaw = reader.angle();
    if (mask & ACTOR_FIELDS.PITCH) snap.pitch = reader.angle();
    if (mask & ACTOR_FIELDS.LEAN) snap.lean = reader.i16() / 1000;
    if (mask & ACTOR_FIELDS.STANCE) {
      snap.stance = STANCES[reader.u8()] ?? 'stand';
      snap.height = reader.u8() / 100;
    }
    if (mask & ACTOR_FIELDS.HEALTH) snap.health = reader.u8();
    if (mask & ACTOR_FIELDS.SHIELD) snap.shield = reader.u8();
    if (mask & ACTOR_FIELDS.WEAPON) {
      snap.charge = reader.u8();
      snap.rechargeProgress = reader.u8() / 255;
    }
    if (mask & ACTOR_FIELDS.FLAGS) snap.flags = reader.u8();
    if (mask & ACTOR_FIELDS.SCORE) {
      snap.score = reader.varint();
      snap.kills = reader.varint();
      snap.deaths = reader.varint();
      snap.assists = reader.varint();
    }
    actors.set(id, snap);
  }

  return {
    snapshot: { tick, time, phase, timeRemaining, scores, actors },
    baselineMissing: false,
  };
}

function blankActor(id: number): ActorSnapshot {
  return {
    id,
    team: 'red',
    px: 0,
    py: 0,
    pz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    lean: 0,
    stance: 'stand',
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
  };
}

const emptySnapshot = (tick: number, time: number): WorldSnapshot => ({
  tick,
  time,
  phase: 0,
  timeRemaining: 0,
  scores: {},
  actors: new Map(),
});

/**
 * Ring buffer of recent snapshots.
 *
 * Serves three jobs at once: delta baselines for the encoder, interpolation source for the client,
 * and the rewind history lag compensation needs to reconstruct where a target was when a shooter
 * actually pulled the trigger.
 */
export class SnapshotHistory {
  private readonly buffer: Array<WorldSnapshot | null>;
  private writeIndex = 0;

  constructor(readonly capacity = SNAPSHOT_HISTORY) {
    this.buffer = new Array(capacity).fill(null);
  }

  push(snapshot: WorldSnapshot): void {
    this.buffer[this.writeIndex] = snapshot;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
  }

  get(tick: number): WorldSnapshot | null {
    for (const snapshot of this.buffer) {
      if (snapshot && snapshot.tick === tick) return snapshot;
    }
    return null;
  }

  /** Most recent snapshot at or before `tick`, for rewinding to a shooter's view of the world. */
  atOrBefore(tick: number): WorldSnapshot | null {
    let best: WorldSnapshot | null = null;
    for (const snapshot of this.buffer) {
      if (!snapshot || snapshot.tick > tick) continue;
      if (!best || snapshot.tick > best.tick) best = snapshot;
    }
    return best;
  }

  /** The two snapshots bracketing `tick`, for interpolation. */
  bracket(tick: number): { from: WorldSnapshot | null; to: WorldSnapshot | null } {
    let from: WorldSnapshot | null = null;
    let to: WorldSnapshot | null = null;
    for (const snapshot of this.buffer) {
      if (!snapshot) continue;
      if (snapshot.tick <= tick && (!from || snapshot.tick > from.tick)) from = snapshot;
      if (snapshot.tick > tick && (!to || snapshot.tick < to.tick)) to = snapshot;
    }
    return { from, to };
  }

  get latest(): WorldSnapshot | null {
    let best: WorldSnapshot | null = null;
    for (const snapshot of this.buffer) {
      if (snapshot && (!best || snapshot.tick > best.tick)) best = snapshot;
    }
    return best;
  }

  clear(): void {
    this.buffer.fill(null);
    this.writeIndex = 0;
  }
}
