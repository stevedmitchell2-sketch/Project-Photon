import { SNAPSHOT_HZ } from './protocol';
import type { ActorSnapshot, SnapshotHistory, WorldSnapshot } from './snapshot';
import { angleDelta, lerp } from '@/util/math';

/**
 * Entity interpolation and extrapolation for remote actors.
 *
 * Remote players are rendered deliberately *behind* the newest snapshot — by default one and a half
 * snapshot intervals. That delay is what buys smooth motion: with two snapshots always bracketing
 * the render time, positions are interpolated rather than guessed, and a single dropped packet is
 * invisible instead of a stutter.
 *
 * The delay is the reason lag compensation exists. A shooter is aiming at where a target was
 * `interpolationDelay + rtt/2` ago, so the server must rewind by exactly that much when validating
 * the shot. The two systems are two halves of one decision and their constants must agree.
 */

const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_HZ;

export interface InterpolationSettings {
  /** How far behind the newest snapshot to render, in milliseconds. */
  delayMs: number;
  /** Cap on extrapolation when snapshots stop arriving. Beyond this, freeze rather than invent. */
  maxExtrapolationMs: number;
  /** Adapt the delay to observed jitter rather than holding a fixed value. */
  adaptive: boolean;
}

export const defaultInterpolationSettings = (): InterpolationSettings => ({
  delayMs: SNAPSHOT_INTERVAL_MS * 1.5,
  maxExtrapolationMs: 120,
  adaptive: true,
});

export interface InterpolatedActor {
  id: number;
  px: number;
  py: number;
  pz: number;
  yaw: number;
  pitch: number;
  lean: number;
  height: number;
  /** Velocity carried through for animation and audio, not re-simulated. */
  vx: number;
  vy: number;
  vz: number;
  /** True when this frame was extrapolated rather than interpolated. */
  extrapolated: boolean;
}

export class Interpolator {
  private settings = defaultInterpolationSettings();
  /** Observed inter-arrival jitter, used to widen the buffer on unstable connections. */
  private jitterMs = 0;
  private lastArrivalMs = 0;

  updateSettings(patch: Partial<InterpolationSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  get delayMs(): number {
    if (!this.settings.adaptive) return this.settings.delayMs;
    // One snapshot interval of headroom plus two standard-ish deviations of jitter. Enough to ride
    // out normal variance without adding latency that a stable connection never needs.
    return Math.max(this.settings.delayMs, SNAPSHOT_INTERVAL_MS + this.jitterMs * 2);
  }

  get jitter(): number {
    return this.jitterMs;
  }

  /** Called on every snapshot arrival to track jitter. */
  noteArrival(nowMs: number): void {
    if (this.lastArrivalMs > 0) {
      const gap = nowMs - this.lastArrivalMs;
      const deviation = Math.abs(gap - SNAPSHOT_INTERVAL_MS);
      this.jitterMs = this.jitterMs * 0.9 + deviation * 0.1;
    }
    this.lastArrivalMs = nowMs;
  }

  /**
   * Samples every remote actor at the render time implied by the interpolation delay.
   *
   * `renderTick` is fractional: the client's estimate of which server tick it should be displaying,
   * derived from the newest snapshot minus the delay.
   */
  sample(history: SnapshotHistory, renderTick: number, out: Map<number, InterpolatedActor>): void {
    const { from, to } = history.bracket(Math.floor(renderTick));
    out.clear();

    if (!from) return;

    if (!to) {
      // No newer snapshot: extrapolate briefly along last known velocity, then hold.
      this.extrapolate(from, renderTick, out);
      return;
    }

    const span = to.tick - from.tick;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (renderTick - from.tick) / span)) : 0;

    for (const [id, a] of from.actors) {
      const b = to.actors.get(id);
      if (!b) continue; // Left between snapshots; drop rather than freeze a ghost.
      out.set(id, {
        id,
        px: lerp(a.px, b.px, alpha),
        py: lerp(a.py, b.py, alpha),
        pz: lerp(a.pz, b.pz, alpha),
        // Angles must interpolate the short way around, or a player crossing +-PI spins 350 degrees.
        yaw: a.yaw + angleDelta(a.yaw, b.yaw) * alpha,
        pitch: lerp(a.pitch, b.pitch, alpha),
        lean: lerp(a.lean, b.lean, alpha),
        height: lerp(a.height, b.height, alpha),
        vx: lerp(a.vx, b.vx, alpha),
        vy: lerp(a.vy, b.vy, alpha),
        vz: lerp(a.vz, b.vz, alpha),
        extrapolated: false,
      });
    }
  }

  /**
   * Dead reckoning when snapshots stop arriving.
   *
   * Bounded hard: past `maxExtrapolationMs` a player is frozen rather than projected. An
   * extrapolated player who was actually strafing ends up somewhere they never were, and correcting
   * that afterwards looks far worse than a brief pause.
   */
  private extrapolate(
    latest: WorldSnapshot,
    renderTick: number,
    out: Map<number, InterpolatedActor>,
  ): void {
    const ticksAhead = Math.max(0, renderTick - latest.tick);
    const secondsAhead = Math.min(ticksAhead / 64, this.settings.maxExtrapolationMs / 1000);

    for (const [id, a] of latest.actors) {
      out.set(id, {
        id,
        px: a.px + a.vx * secondsAhead,
        py: a.py + a.vy * secondsAhead,
        pz: a.pz + a.vz * secondsAhead,
        yaw: a.yaw,
        pitch: a.pitch,
        lean: a.lean,
        height: a.height,
        vx: a.vx,
        vy: a.vy,
        vz: a.vz,
        extrapolated: secondsAhead > 0,
      });
    }
  }

  reset(): void {
    this.jitterMs = 0;
    this.lastArrivalMs = 0;
  }
}

/** Rewound world used by server-side lag compensation. */
export interface RewoundActor {
  id: number;
  px: number;
  py: number;
  pz: number;
  height: number;
}

/**
 * Reconstructs where every actor was at `targetTick`, from the server's snapshot history.
 *
 * This is the fairness mechanism: a client fires at what its screen showed, which is the world as
 * of `now - interpolationDelay - rtt/2`. Validating that shot against the *present* server state
 * would make every shot at a moving target miss, and players would correctly report that their
 * hits do not register. The server rewinds, tests, and restores.
 *
 * The trade-off is explicit and worth stating: rewinding means a player who has already broken line
 * of sight can still be tagged by a shot that was fair on the shooter's screen. That is the
 * conventional choice — favouring the shooter — and it is capped by `maxRewindTicks` so a client
 * cannot claim arbitrary latency to shoot into the past.
 */
export function rewind(
  history: SnapshotHistory,
  targetTick: number,
  maxRewindTicks: number,
  currentTick: number,
  out: Map<number, RewoundActor>,
): boolean {
  out.clear();
  const clamped = Math.max(currentTick - maxRewindTicks, Math.min(targetTick, currentTick));
  const { from, to } = history.bracket(clamped);
  if (!from) return false;

  const span = to ? to.tick - from.tick : 0;
  const alpha = span > 0 ? Math.min(1, Math.max(0, (clamped - from.tick) / span)) : 0;

  for (const [id, a] of from.actors) {
    const b = to?.actors.get(id);
    out.set(id, {
      id,
      px: b ? lerp(a.px, b.px, alpha) : a.px,
      py: b ? lerp(a.py, b.py, alpha) : a.py,
      pz: b ? lerp(a.pz, b.pz, alpha) : a.pz,
      height: b ? lerp(a.height, b.height, alpha) : a.height,
    });
  }
  return true;
}

export const snapshotIntervalMs = SNAPSHOT_INTERVAL_MS;

/** Convenience for the connection-quality readout. */
export function interpolationBudget(rttMs: number, jitterMs: number): number {
  return SNAPSHOT_INTERVAL_MS + jitterMs * 2 + rttMs / 2;
}

export type { ActorSnapshot };
