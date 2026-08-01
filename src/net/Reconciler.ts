import { TICK_DT } from '@/engine/GameLoop';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { MOVEMENT } from '@/config/movement';
import { stepMovement } from '@/gameplay/MovementSystem';
import type { Actor, GameEvents } from '@/gameplay/types';
import type { EventBus } from '@/engine/EventBus';
import { copyInputFrame, createInputFrame, type InputFrame } from '@/input/InputFrame';
import { distSq3 } from '@/util/math';
import type { ActorSnapshot } from './snapshot';
import { applyActorSnapshot } from './snapshot';

/**
 * Client-side prediction and server reconciliation for the local player.
 *
 * The client simulates its own movement immediately so the controls feel instant, then continuously
 * checks that prediction against the server's authoritative result. When they disagree, the client
 * snaps to the server state at the tick the server had processed, and *replays* every input the
 * server has not yet acknowledged. The player sees a small correction rather than a rubber-band,
 * because the replay puts them back where their own inputs say they should be.
 *
 * The correctness requirement is that `stepMovement` produce identical output for identical input
 * on both sides. That is why movement is a pure function of (actor, physics, dt) with a fixed dt
 * and no `Math.random()` — the whole simulation design exists to make this loop trustworthy.
 */

/**
 * Position error above which we correct at all.
 *
 * Must sit above the natural noise floor or the client corrects on literally every snapshot. Two
 * effects set that floor: position quantisation (~4 mm), and — much larger — the client and server
 * tick clocks free-running independently, so the server may consume an input up to a tick early or
 * late. One tick at sprint speed is 8.4 / 64 ≈ 0.13 m, so anything below that is measuring clock
 * drift rather than a genuine prediction failure.
 *
 * Raising this above the real noise floor was tried and rejected: it cut the correction rate only
 * from 22/s to 17/s while making the system blind to genuine errors. The cause was not noise but a
 * systematic clock offset, fixed properly in `NetServer.dequeueInput`.
 */
const POSITION_TOLERANCE = 0.05;
/** Error above which we hard-snap instead of smoothing. A teleport or a big desync. */
const HARD_SNAP_DISTANCE = 2.5;
/** How quickly a smoothed correction is paid off, in seconds. */
const CORRECTION_HALF_LIFE = 0.08;

export interface ReconcileStats {
  /** Inputs sent but not yet acknowledged by the server. */
  pendingInputs: number;
  /** Distance between prediction and server truth on the last correction, in metres. */
  lastErrorMetres: number;
  /** Corrections applied in the last second. */
  correctionsPerSecond: number;
  /** Ticks replayed on the last reconciliation. */
  lastReplayTicks: number;
  /** Residual visual offset still being smoothed out. */
  smoothingOffset: { x: number; y: number; z: number };
  /**
   * Snapshots whose acknowledged tick had no stored prediction to compare against.
   *
   * These are silently skipped, so a client with a high miss count looks *perfectly accurate* in
   * the correction stats while actually never evaluating its prediction at all. Counted separately
   * because zero corrections means two very different things depending on this number.
   */
  lookupMisses: number;
  /** Snapshots where a stored prediction was found and compared. */
  comparisons: number;
  /**
   * Prediction error summed over *every* comparison, not only the ones that crossed the tolerance.
   *
   * Correction frequency alone cannot distinguish a client that is predicting well from one whose
   * errors all happen to sit just under the threshold. Accumulating the raw error gives the mean
   * that the latency sweep actually reports.
   */
  errorSumMetres: number;
  /** Largest single prediction error observed, in metres. */
  maxErrorMetres: number;
  /** Cumulative corrections applied, as opposed to the per-second rate. */
  totalCorrections: number;
  /** Replayed ticks summed over every correction, for the replay-cost read. */
  totalReplayTicks: number;
}

export class Reconciler {
  /** Ring of inputs by tick, retained until the server acknowledges them. */
  private readonly pending = new Map<number, InputFrame>();
  /**
   * What the client predicted its position would be *after* simulating each tick.
   *
   * Reconciliation is only meaningful against this. Comparing the client's current position to the
   * server's older snapshot compares two different moments in time and always disagrees — at 20 Hz
   * the client legitimately runs ~3 ticks ahead, which at sprint speed is ~0.4 m of perfectly
   * correct lead. Measuring that as prediction error produced a permanent 20/s correction rate.
   */
  private readonly predicted = new Map<number, { x: number; y: number; z: number }>();
  private lastAcknowledgedTick = -1;
  private correctionTimestamps: number[] = [];

  /**
   * Visual offset applied to the camera to hide small corrections.
   *
   * The actor snaps to the corrected position instantly (so shooting stays consistent with the
   * server), but the camera is offset by the correction and decays that offset over ~80 ms. The
   * player never sees the snap; the simulation never lies about where they are.
   */
  readonly smoothing = { x: 0, y: 0, z: 0 };

  /**
   * Diagnostic: histogram of prediction error against *neighbouring* ticks.
   *
   * Reconciliation is only correct if the stored prediction for the acknowledged tick is the right
   * thing to compare the server's snapshot against. If it is not — if the two are systematically
   * offset by some number of ticks — then the residual error is a measurement artefact rather than
   * a prediction failure, and no amount of tuning the simulation will remove it.
   *
   * This answers that directly: for each snapshot, it measures the error against the prediction at
   * `ack + n` for a range of `n`, and reports which offset minimises it. A correct implementation
   * bottoms out at n = 0. Off by default; enabled by `scripts/predictionAlign.ts`.
   */
  alignmentProbe: { sums: number[]; counts: number[]; span: number } | null = null;

  enableAlignmentProbe(span = 24): void {
    this.alignmentProbe = { sums: new Array(span * 2 + 1).fill(0), counts: new Array(span * 2 + 1).fill(0), span };
  }

  readonly stats: ReconcileStats = {
    pendingInputs: 0,
    lastErrorMetres: 0,
    correctionsPerSecond: 0,
    lastReplayTicks: 0,
    smoothingOffset: { x: 0, y: 0, z: 0 },
    lookupMisses: 0,
    comparisons: 0,
    errorSumMetres: 0,
    maxErrorMetres: 0,
    totalCorrections: 0,
    totalReplayTicks: 0,
  };

  /** Records an input the client has applied locally and sent to the server. */
  record(tick: number, input: InputFrame): void {
    const stored = createInputFrame();
    copyInputFrame(stored, input);
    stored.tick = tick;
    this.pending.set(tick, stored);

    // Bound the buffer. Two seconds of inputs is far more than any playable latency.
    if (this.pending.size > 128) {
      const oldest = Math.min(...this.pending.keys());
      this.pending.delete(oldest);
    }
    this.stats.pendingInputs = this.pending.size;
  }

  /** Records where the local simulation actually ended up after simulating `tick`. */
  recordPrediction(tick: number, position: { x: number; y: number; z: number }): void {
    this.predicted.set(tick, { x: position.x, y: position.y, z: position.z });
    if (this.predicted.size > 128) {
      const oldest = Math.min(...this.predicted.keys());
      this.predicted.delete(oldest);
    }
  }

  /** Inputs the server has not confirmed, oldest first — resent in every packet. */
  unacknowledged(limit: number): InputFrame[] {
    const ticks = [...this.pending.keys()].sort((a, b) => a - b);
    const recent = ticks.slice(-limit);
    return recent.map((t) => this.pending.get(t)!);
  }

  /**
   * Applies the server's authoritative state for the local player and replays unacknowledged input.
   *
   * `acknowledgedTick` is the last client input tick the server had consumed when it produced this
   * snapshot. Everything after it is still "in flight" and must be re-simulated.
   */
  reconcile(
    actor: Actor,
    serverState: ActorSnapshot,
    acknowledgedTick: number,
    currentTick: number,
    physics: PhysicsWorld,
    events: EventBus<GameEvents>,
  ): void {
    // Stale or duplicate snapshot: nothing to learn from it.
    if (acknowledgedTick <= this.lastAcknowledgedTick) return;
    this.lastAcknowledgedTick = acknowledgedTick;

    // Compare the server's result against what we predicted *for that same tick*. Without a stored
    // prediction we cannot judge, so we trust our own simulation rather than correcting blindly.
    const predictedAtAck = this.predicted.get(acknowledgedTick);

    if (this.alignmentProbe) {
      const probe = this.alignmentProbe;
      const authoritativeNow = { x: serverState.px, y: serverState.py, z: serverState.pz };
      for (let n = -probe.span; n <= probe.span; n++) {
        const candidate = this.predicted.get(acknowledgedTick + n);
        if (!candidate) continue;
        const i = n + probe.span;
        probe.sums[i] += Math.sqrt(distSq3(candidate, authoritativeNow));
        probe.counts[i]++;
      }
    }

    for (const tick of [...this.pending.keys()]) {
      if (tick <= acknowledgedTick) this.pending.delete(tick);
    }
    for (const tick of [...this.predicted.keys()]) {
      if (tick < acknowledgedTick) this.predicted.delete(tick);
    }
    this.stats.pendingInputs = this.pending.size;

    if (!predictedAtAck) {
      this.stats.lookupMisses++;
      adoptServerAuthority(actor, serverState);
      return;
    }
    this.stats.comparisons++;

    const current = { x: actor.position.x, y: actor.position.y, z: actor.position.z };
    const authoritative = { x: serverState.px, y: serverState.py, z: serverState.pz };
    const errorSq = distSq3(predictedAtAck, authoritative);

    // Sampled on every comparison, before the tolerance test, so the mean reflects how well
    // prediction is actually tracking rather than only how often it failed loudly.
    const sampledError = Math.sqrt(errorSq);
    this.stats.errorSumMetres += sampledError;
    if (sampledError > this.stats.maxErrorMetres) this.stats.maxErrorMetres = sampledError;

    if (errorSq <= POSITION_TOLERANCE * POSITION_TOLERANCE) {
      // Prediction agreed. Still adopt server-authored fields the client does not simulate.
      adoptServerAuthority(actor, serverState);
      this.stats.lastReplayTicks = 0;
      return;
    }

    // Rewind to the server's truth, keeping our own look angles.
    applyActorSnapshot(actor, serverState, false);
    physics.setCharacterPosition(actor.bodyHandle, {
      x: actor.position.x,
      y: actor.position.y + actor.height * 0.5,
      z: actor.position.z,
    });

    // Replay every input the server has not seen yet.
    const replayTicks = [...this.pending.keys()].sort((a, b) => a - b);
    const savedInput = createInputFrame();
    copyInputFrame(savedInput, actor.input);

    // Replay fidelity is verified, not assumed. `scripts/predictionAB.ts` runs an identical input
    // sequence through the live path (full MatchDirector.step) and this replay path, and reports
    // them bit-identical in isolation — 0 m divergence over 640 ticks, and 1.9 mm with six actors
    // present. So the replay itself is sound.
    //
    // The correction rate that remains is actor-vs-actor collision: locally the player resolves
    // against *interpolated* peer positions while the server resolves against live ones. Measured
    // as 3-4 corrections/s for a player in open space versus 22/s for players in contact. The
    // standard fix is to exclude remote actors from the local player's collision filter during
    // prediction and let the server arbitrate contact; see NEXT_TASK.md.
    for (const tick of replayTicks) {
      if (tick > currentTick) break;
      const input = this.pending.get(tick);
      if (!input) continue;
      copyInputFrame(actor.input, input);
      // Replayed ticks must not re-emit audio or FX — the player already heard them live.
      stepMovement(actor, physics, TICK_DT, events);
    }
    copyInputFrame(actor.input, savedInput);

    const error = sampledError;
    this.stats.lastErrorMetres = error;
    this.stats.lastReplayTicks = replayTicks.length;
    this.stats.totalCorrections++;
    this.stats.totalReplayTicks += replayTicks.length;

    const now = performance.now();
    this.correctionTimestamps.push(now);
    this.correctionTimestamps = this.correctionTimestamps.filter((t) => now - t < 1000);
    this.stats.correctionsPerSecond = this.correctionTimestamps.length;

    if (error < HARD_SNAP_DISTANCE) {
      // Carry the visual discrepancy in the camera offset and decay it, rather than snapping.
      this.smoothing.x += current.x - actor.position.x;
      this.smoothing.y += current.y - actor.position.y;
      this.smoothing.z += current.z - actor.position.z;
    } else {
      // Too far to hide. Snap honestly; hiding a 3 m correction looks worse than showing it.
      this.smoothing.x = 0;
      this.smoothing.y = 0;
      this.smoothing.z = 0;
    }
  }

  /** Decays the visual correction offset. Called once per rendered frame. */
  update(frameDt: number): void {
    const decay = Math.pow(2, -frameDt / CORRECTION_HALF_LIFE);
    this.smoothing.x *= decay;
    this.smoothing.y *= decay;
    this.smoothing.z *= decay;
    if (Math.abs(this.smoothing.x) < 1e-4) this.smoothing.x = 0;
    if (Math.abs(this.smoothing.y) < 1e-4) this.smoothing.y = 0;
    if (Math.abs(this.smoothing.z) < 1e-4) this.smoothing.z = 0;
    this.stats.smoothingOffset = { ...this.smoothing };
  }

  reset(): void {
    this.pending.clear();
    this.predicted.clear();
    this.lastAcknowledgedTick = -1;
    this.smoothing.x = 0;
    this.smoothing.y = 0;
    this.smoothing.z = 0;
    this.correctionTimestamps.length = 0;
  }
}

/**
 * Fields the server owns outright even when prediction was correct.
 *
 * The client never predicts damage: it does not know what other players did, and a client that
 * decided its own health would be the first thing any cheat tool patched.
 */
function adoptServerAuthority(actor: Actor, snap: ActorSnapshot): void {
  actor.health = snap.health;
  actor.shield = snap.shield;
  actor.score = snap.score;
  actor.kills = snap.kills;
  actor.deaths = snap.deaths;
  actor.assists = snap.assists;
  actor.team = snap.team;
  if (!actor.alive && (snap.flags & 1) !== 0) {
    // Server says we respawned; take its position rather than predicting a spawn point.
    actor.position.x = snap.px;
    actor.position.y = snap.py;
    actor.position.z = snap.pz;
  }
  actor.alive = (snap.flags & 1) !== 0;
  void MOVEMENT;
}
