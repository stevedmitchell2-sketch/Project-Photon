import { MOVEMENT } from '@/config/movement';
import type { Actor, MatchState } from '@/gameplay/types';
import type { Vec3 } from '@/util/math';
import { rewind, type RewoundActor } from './Interpolator';
import { SnapshotHistory } from './snapshot';

/**
 * Server-side lag compensation for hit validation.
 *
 * A shooter fires at what their screen shows, which is the world as of
 * `interpolationDelay + rtt/2` ago. Validating that shot against the present server state makes
 * every shot at a moving target miss, and players correctly report that their hits do not register.
 *
 * So the server rewinds: it reconstructs where every actor was at the shooter's view time, tests
 * the shot against *that*, and restores. This is the standard "favour the shooter" trade, and it
 * has a real cost worth naming — a player who has already stepped behind a wall can still be tagged
 * by a shot that was fair on the shooter's screen. The alternative (favour the target) makes
 * shooting feel broken for everyone, which is worse.
 *
 * Two guards keep it honest:
 *   - rewind is capped at `MAX_REWIND_MS`, so a client cannot claim arbitrary latency to shoot
 *     further into the past
 *   - the rewound position is validated against the actor's *current* position, so a rewind that
 *     implies impossible movement is rejected rather than trusted
 */

/** Hard cap on how far back the server will look. 250 ms is the brief's supported latency ceiling. */
export const MAX_REWIND_MS = 250;
const MAX_REWIND_TICKS = Math.round((MAX_REWIND_MS / 1000) * 64);

export interface CompensatedHit {
  actorId: number;
  /** Position used for the test — the rewound one. */
  position: Vec3;
  height: number;
  /** How far back the test was performed, in milliseconds. */
  rewoundMs: number;
}

export class LagCompensator {
  /** Server-side history of every actor, independent of any client's delta baselines. */
  private readonly history = new SnapshotHistory(64);
  private readonly rewound = new Map<number, RewoundActor>();
  /** Saved present-tick positions, restored after the test. */
  private readonly saved = new Map<number, Vec3>();

  /** Records a tick of world state. Called on the snapshot cadence from the server loop. */
  record(state: MatchState): void {
    const actors = new Map<number, ReturnType<typeof captureLight>>();
    for (const actor of state.actors.values()) actors.set(actor.id, captureLight(actor));
    this.history.push({
      tick: state.tick,
      time: state.time,
      phase: 0,
      timeRemaining: state.timeRemaining,
      scores: {},
      // The rewind path only reads position and height, so the rest is left at defaults.
      actors: actors as never,
    });
  }

  /**
   * Rewinds the world to `viewTick`, runs `test`, then restores.
   *
   * The callback shape guarantees restoration even if the test throws, which matters because a
   * world left rewound would be catastrophic — every subsequent hit test in that tick would be
   * against stale positions.
   */
  withRewind<T>(
    state: MatchState,
    viewTick: number,
    physicsSync: (actor: Actor) => void,
    test: () => T,
  ): T {
    const applied = this.applyRewind(state, viewTick, physicsSync);
    try {
      return test();
    } finally {
      if (applied) this.restore(state, physicsSync);
    }
  }

  private applyRewind(
    state: MatchState,
    viewTick: number,
    physicsSync: (actor: Actor) => void,
  ): boolean {
    if (!rewind(this.history, viewTick, MAX_REWIND_TICKS, state.tick, this.rewound)) return false;

    this.saved.clear();
    for (const [id, past] of this.rewound) {
      const actor = state.actors.get(id);
      if (!actor || !actor.alive) continue;

      // Reject a rewind implying movement the character could not have made. Guards against a
      // corrupted history and against a client manipulating its reported view time.
      const dx = past.px - actor.position.x;
      const dz = past.pz - actor.position.z;
      const elapsedTicks = Math.max(1, state.tick - viewTick);
      const maxTravel =
        ((MOVEMENT.sprintSpeed + MOVEMENT.slideStartSpeedBonus) * elapsedTicks) / 64 + 1;
      if (Math.hypot(dx, dz) > maxTravel) continue;

      this.saved.set(id, { x: actor.position.x, y: actor.position.y, z: actor.position.z });
      actor.position.x = past.px;
      actor.position.y = past.py;
      actor.position.z = past.pz;
      physicsSync(actor);
    }
    return this.saved.size > 0;
  }

  private restore(state: MatchState, physicsSync: (actor: Actor) => void): void {
    for (const [id, position] of this.saved) {
      const actor = state.actors.get(id);
      if (!actor) continue;
      actor.position.x = position.x;
      actor.position.y = position.y;
      actor.position.z = position.z;
      physicsSync(actor);
    }
    this.saved.clear();
  }

  /**
   * View tick for a shooter, from their round-trip time and the interpolation delay they render at.
   * This is the single place the two halves of the latency budget are added together.
   */
  static viewTickFor(currentTick: number, rttMs: number, interpolationDelayMs: number): number {
    const totalMs = Math.min(MAX_REWIND_MS, rttMs / 2 + interpolationDelayMs);
    return currentTick - Math.round((totalMs / 1000) * 64);
  }

  clear(): void {
    this.history.clear();
    this.rewound.clear();
    this.saved.clear();
  }
}

/** Minimal per-actor record — rewind only needs position and capsule height. */
function captureLight(actor: Actor) {
  return {
    id: actor.id,
    px: actor.position.x,
    py: actor.position.y,
    pz: actor.position.z,
    height: actor.height,
  };
}
