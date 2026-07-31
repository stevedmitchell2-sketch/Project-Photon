import type { MatchState } from '@/gameplay/types';
import { captureWorld, decodeSnapshot, encodeSnapshot, SnapshotHistory } from '@/net/snapshot';
import { Interpolator } from '@/net/Interpolator';

/**
 * Netcode self-check.
 *
 * Serialization bugs are the worst class of bug in a multiplayer game: they do not throw, they
 * produce a client that is quietly looking at a slightly different world than the server. This
 * exercises the full encode → decode → apply path against live match state and reports whether the
 * round trip is lossless within quantisation tolerance, plus what it actually costs in bytes.
 *
 * DEV-only, exposed as `__PHOTON__.probeNet()`.
 */

export interface NetProbeReport {
  actors: number;
  fullSnapshotBytes: number;
  deltaSnapshotBytes: number;
  idleDeltaBytes: number;
  /** Projected bandwidth at 20 snapshots/second, in kilobits per second, per client. */
  kbitsPerSecond: number;
  /** Largest position error introduced by quantisation, in metres. */
  maxPositionError: number;
  maxAngleError: number;
  /** True when every actor survived the round trip with matching identity and team. */
  lossless: boolean;
  interpolationDelayMs: number;
  notes: string[];
}

export function probeNetcode(state: MatchState): NetProbeReport {
  const notes: string[] = [];
  const history = new SnapshotHistory();

  // Baseline snapshot, encoded in full.
  const first = captureWorld(state);
  history.push(first);
  const fullBytes = encodeSnapshot(first, null);

  const decodedFull = decodeSnapshot(fullBytes, history);
  if (!decodedFull || decodedFull.baselineMissing) {
    notes.push('full snapshot failed to decode');
    return failure(notes, fullBytes.byteLength);
  }

  // A second snapshot with no changes at all — the floor of what an idle player costs.
  const idle = captureWorld(state);
  idle.tick = first.tick + 1;
  const idleBytes = encodeSnapshot(idle, first);

  // A snapshot where everyone has moved, which is the realistic steady-state cost.
  const moved = captureWorld(state);
  moved.tick = first.tick + 2;
  for (const actor of moved.actors.values()) {
    actor.px += 0.13;
    actor.pz -= 0.08;
    actor.yaw += 0.05;
  }
  history.push(moved);
  const deltaBytes = encodeSnapshot(moved, first);

  const decodedDelta = decodeSnapshot(deltaBytes, history);
  if (!decodedDelta || decodedDelta.baselineMissing) {
    notes.push('delta snapshot could not resolve its baseline');
    return failure(notes, fullBytes.byteLength);
  }

  // Compare the decoded delta against what we encoded.
  let maxPositionError = 0;
  let maxAngleError = 0;
  let lossless = true;

  for (const [id, original] of moved.actors) {
    const roundTripped = decodedDelta.snapshot.actors.get(id);
    if (!roundTripped) {
      lossless = false;
      notes.push(`actor ${id} missing after round trip`);
      continue;
    }
    if (roundTripped.team !== original.team) {
      lossless = false;
      notes.push(`actor ${id} changed team in transit`);
    }
    maxPositionError = Math.max(
      maxPositionError,
      Math.abs(roundTripped.px - original.px),
      Math.abs(roundTripped.py - original.py),
      Math.abs(roundTripped.pz - original.pz),
    );
    maxAngleError = Math.max(maxAngleError, Math.abs(roundTripped.yaw - original.yaw));
  }

  // Quantisation is lossy by design; anything beyond half a step is a real bug.
  const positionTolerance = 1 / 256 / 2;
  if (maxPositionError > positionTolerance) {
    lossless = false;
    notes.push(
      `position error ${maxPositionError.toFixed(5)} m exceeds quantisation step ${positionTolerance.toFixed(5)} m`,
    );
  }

  const interpolator = new Interpolator();
  const kbits = (deltaBytes.byteLength * 20 * 8) / 1000;

  if (deltaBytes.byteLength >= fullBytes.byteLength) {
    notes.push('delta is not smaller than a full snapshot — delta encoding is not working');
  }

  return {
    actors: moved.actors.size,
    fullSnapshotBytes: fullBytes.byteLength,
    deltaSnapshotBytes: deltaBytes.byteLength,
    idleDeltaBytes: idleBytes.byteLength,
    kbitsPerSecond: Math.round(kbits * 10) / 10,
    maxPositionError: Math.round(maxPositionError * 100000) / 100000,
    maxAngleError: Math.round(maxAngleError * 100000) / 100000,
    lossless,
    interpolationDelayMs: Math.round(interpolator.delayMs),
    notes,
  };
}

function failure(notes: string[], fullBytes: number): NetProbeReport {
  return {
    actors: 0,
    fullSnapshotBytes: fullBytes,
    deltaSnapshotBytes: 0,
    idleDeltaBytes: 0,
    kbitsPerSecond: 0,
    maxPositionError: Infinity,
    maxAngleError: Infinity,
    lossless: false,
    interpolationDelayMs: 0,
    notes,
  };
}
