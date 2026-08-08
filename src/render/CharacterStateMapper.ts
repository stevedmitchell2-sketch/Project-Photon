import { MOVEMENT } from '@/config/movement';
import { TICK_DT } from '@/engine/GameLoop';
import type { Actor } from '@/gameplay/types';
import { angleDelta, speedXZ } from '@/util/math';

/**
 * Simulation state -> animation state.
 *
 * The presentation half of the character system. `AssetAnimator` decides which *clip* represents a
 * state; this decides which *state* an actor is in. Both are downstream of the simulation and
 * neither may write to it.
 *
 * ## Why this moved out of AssetAvatars
 *
 * It started as a nine-line pure function inside the renderer, which was right while every state was
 * a direct read of a single actor field. Four of the states in the animation pack are not:
 *
 * - **sprint** needs a threshold with hysteresis, or the clip flickers at the boundary;
 * - **landing** is an *edge* — it needs to know the actor was airborne a moment ago;
 * - **turning** needs a yaw rate held long enough to be a turn rather than a flick;
 * - **interact** is not derivable from actor state at all; something has to ask for it.
 *
 * All four need memory, and memory in the middle of a `useFrame` loop is where animation bugs go to
 * hide. Out here it is a plain class with no Three.js import, so every threshold and every edge is
 * directly testable.
 *
 * ## Determinism and multiplayer safety
 *
 * Every input is replicated simulation state: `velocity`, `grounded`, `airTime`, `stance`, `yaw`,
 * `prevYaw`, `alive`. Two clients watching the same actor see the same tier transitions and the same
 * landing edges, because they are watching the same numbers.
 *
 * The memory this class keeps is per-actor and **write-only from here** — nothing in it is ever read
 * by the simulation, and `resolve` never touches the actor it is passed (locked down by a test that
 * hands it a frozen actor). An animation state that disagrees between two clients is a cosmetic
 * difference and cannot become a gameplay one.
 *
 * `interact` is the one state with an external trigger, and it is deliberately *not* replicated —
 * see `triggerInteract`.
 */

/**
 * Speed bands, derived from `MOVEMENT` rather than written down again.
 *
 * ## The band that was wrong
 *
 * The previous mapper used a single hard threshold: `speed > 6 -> run`, else `walk`. `walkSpeed` is
 * 5.2, so **6 sits above the fastest a non-sprinting player can move**. The `run` state was
 * unreachable without holding sprint, and normal movement — the speed a player spends the whole
 * match at — played the walk clip. The old `run` was already the sprint in everything but name,
 * which is why splitting sprint off it needs the boundary moved rather than added to.
 *
 * So the bands now follow the two speeds the movement config actually defines: normal movement runs,
 * and the sprint band starts midway between `walkSpeed` and `sprintSpeed`.
 *
 * ## Hysteresis
 *
 * Each tier has a higher entry threshold than exit threshold. Without the gap, a player holding
 * sprint against a slope oscillates around a single number and the animator cross-fades several
 * times a second — which is far more visible than being in the "wrong" tier for a few frames.
 */
const SPRINT_MID = (MOVEMENT.walkSpeed + MOVEMENT.sprintSpeed) / 2;
/** Half-width of the dead band around each boundary, in m/s. */
const BAND = 0.35;

export const LOCOMOTION_TIERS = ['idle', 'walk', 'run', 'sprint'] as const;
export type LocomotionTier = (typeof LOCOMOTION_TIERS)[number];

/** Speed at or above which each tier is entered from the tier below. Index 0 is unused. */
const TIER_ENTER = [
  Number.NEGATIVE_INFINITY,
  // Preserved exactly from the previous mapper: below this an actor is standing, not creeping.
  0.35,
  MOVEMENT.walkSpeed * 0.58,
  SPRINT_MID + BAND,
] as const;

/** Speed below which each tier is left downward. Must sit under the matching entry threshold. */
const TIER_EXIT = [
  Number.NEGATIVE_INFINITY,
  0.2,
  MOVEMENT.walkSpeed * 0.44,
  SPRINT_MID - BAND,
] as const;

/**
 * Turning.
 *
 * Yaw rate comes from `angleDelta(prevYaw, yaw) / TICK_DT` — the actor's own replicated yaw history,
 * divided by the tick it was measured over. Not the render delta: `prevYaw` is one *simulation* tick
 * old regardless of how many frames the renderer drew in between, and dividing by a frame delta
 * would make the rate a function of frame rate.
 */
const TURN = {
  /** rad/s to start turning. ~92 deg/s — a deliberate look-around, not a correction. */
  enter: 1.6,
  /** rad/s to stop. Well under `enter`, so a turn that eases off does not chatter. */
  exit: 0.7,
  /**
   * Minimum time the state is held once entered, in seconds.
   *
   * A mouse flick crosses `enter` for two frames. Without a floor, that is a two-frame cross-fade
   * into a turn clip and straight back out, which reads as a twitch. 0.22 s is long enough for the
   * turn to register and short enough that it never delays a locomotion start.
   */
  hold: 0.22,
} as const;

/**
 * Landing.
 *
 * The edge is airborne -> grounded, qualified by how long the actor was actually off the ground.
 * Unqualified, it fires constantly: `grounded` flickers for a single tick whenever a player crosses
 * a step, a ramp seam or the lip of a gallery, and each flicker would restart an impact animation.
 */
const LANDING = {
  /** Seconds airborne before a touchdown counts as a landing. Below this it was a bump. */
  minAirTime: 0.18,
  /**
   * Seconds the landing state is held before locomotion resumes.
   *
   * Shorter than Mixamo's `Hard Landing` (~1.4 s) on purpose. This is a competitive shooter: the
   * player is already moving again and holding the full absorb would leave the mesh crouched while
   * the capsule sprinted away. The clip is played held rather than looped, so cutting it short is a
   * cross-fade out of a partial pose, which is exactly what a recovery looks like.
   */
  hold: 0.34,
  /**
   * A landing is abandoned early once the actor is moving at least this fast, in m/s.
   *
   * Set to the sprint entry threshold, which makes a landing survive a walk and a run and be skipped
   * only at sprint. It was `walkSpeed * 0.75` first, and a live sample explained why that was wrong:
   * bots land moving almost every time, and 3 landings in 20 seconds across 5 players got through —
   * one of them at 3.71 m/s, barely under the gate. A state that exists and is unreachable in normal
   * play is the same failure the animation pack was written to avoid.
   */
  breakSpeed: SPRINT_MID + BAND,
} as const;

/**
 * Airborne.
 *
 * `grounded` is not a clean signal. A live sample of five bots on Apex showed repeated single-tick
 * drops — `fall` entered and left inside 18 ms, once at 9.53 m/s — as they crossed ramp seams, step
 * lips and bridge joints. Each one is a cross-fade into a falling clip and straight back out.
 *
 * So airborne, like landing, is qualified by time. This is the same class of fix as the speed dead
 * bands: the threshold has not moved, it has just been given a floor so noise cannot cross it.
 */
const AIRBORNE = {
  /**
   * Seconds off the ground before an actor is reported airborne.
   *
   * ~4 ticks. A real jump is airborne for the better part of a second, so this delays the jump clip
   * imperceptibly; a seam crossing never reaches it at all.
   */
  minTime: 0.07,
} as const;

/** Default seconds an `interact` request occupies the character. */
const INTERACT_DEFAULT_HOLD = 1.1;

export interface AnimationDecision {
  /** State name to hand to `clipFor`. */
  state: string;
  /**
   * True only on the frame the state begins, and only for states that are events rather than
   * conditions. The renderer plays these held-once instead of looped.
   */
  once: boolean;
  /**
   * Turn direction: -1 left, +1 right, 0 not turning.
   *
   * The hook for mirroring. Mixamo ships `Left Turn`; a right turn is the same motion reflected, and
   * an asset that supplies its own right-turn clip gets used for it. Reported for every state, not
   * just `turning`, so a future upper-body lean has the same signal available.
   */
  turnSign: -1 | 0 | 1;
}

interface ActorMemory {
  tier: number;
  /** Seconds remaining in a held one-shot, or 0. */
  holdLeft: number;
  /** The state the hold belongs to, so a second trigger of the same kind does not restart it. */
  holdState: string;
  /** Seconds remaining before `turning` may be released. */
  turnHoldLeft: number;
  turning: boolean;
  turnSign: -1 | 0 | 1;
  grounded: boolean;
  /** `airTime` as of the previous resolve, since it is zeroed on touchdown. */
  airTime: number;
  /** Set by `triggerInteract`, consumed on the next resolve. */
  interactRequest: number;
  alive: boolean;
  /** The last state returned, for inspection. Never read by the mapper's own logic. */
  lastState: string;
}

function freshMemory(actor: Actor): ActorMemory {
  return {
    tier: 0,
    holdLeft: 0,
    holdState: '',
    turnHoldLeft: 0,
    turning: false,
    turnSign: 0,
    grounded: actor.grounded,
    airTime: actor.airTime,
    interactRequest: 0,
    alive: actor.alive,
    lastState: '',
  };
}

export class CharacterStateMapper {
  private readonly memory = new Map<number, ActorMemory>();

  /**
   * Requests the service/interaction animation for an actor.
   *
   * The clean trigger the animation pack asked for, and deliberately nothing more. It plays a clip;
   * it does not reserve the actor, block input, gate a capture, or start a timer the simulation can
   * see. Arena-service interactions can call this the moment they exist without having to unpick any
   * gameplay meaning from it first.
   *
   * **Not replicated.** A remote client that never receives the call simply does not see the
   * animation. That is the correct failure: replicating it would put a cosmetic request on the wire
   * and make a presentation concern part of the netcode's contract. When a real interaction system
   * exists it will replicate its own gameplay event, and each client can call this off the back of
   * it.
   *
   * Ignored for a dead actor, and dropped as soon as the actor leaves the ground or moves off — a
   * button press while sprinting past is worse than no animation at all.
   */
  triggerInteract(actorId: number, duration = INTERACT_DEFAULT_HOLD): void {
    const memory = this.memory.get(actorId);
    if (memory) memory.interactRequest = duration;
    // No memory yet means the actor has not been drawn. Nothing to queue against, and queueing
    // across a slot assignment would fire the animation at an arbitrary later moment.
  }

  /** Forgets an actor. Called when a render slot is released, so the map cannot grow unbounded. */
  release(actorId: number): void {
    this.memory.delete(actorId);
  }

  reset(): void {
    this.memory.clear();
  }

  /** For assertions in tests and the dev overlay. */
  tierOf(actorId: number): LocomotionTier | null {
    const memory = this.memory.get(actorId);
    return memory ? LOCOMOTION_TIERS[memory.tier] : null;
  }

  /**
   * The state most recently returned for an actor.
   *
   * Read-only, and the reason it exists rather than the dev probe simply calling `resolve` again:
   * `resolve` advances hold timers and consumes edges. A probe calling it would run the mapper twice
   * per frame, halve every hold, and swallow the landing edge and the interact request before the
   * renderer ever saw them — an observer that changes what it observes.
   */
  stateOf(actorId: number): string | null {
    return this.memory.get(actorId)?.lastState ?? null;
  }

  /**
   * Resolves an actor's animation state.
   *
   * `dt` is the *render* delta, and is used only to run down presentation hold timers. Nothing about
   * the decision is integrated over it — every threshold reads instantaneous simulation state — so a
   * dropped frame shortens a hold slightly and changes nothing else.
   */
  resolve(actor: Actor, dt: number): AnimationDecision {
    const decision = this.decide(actor, dt);
    const memory = this.memory.get(actor.id);
    if (memory) memory.lastState = decision.state;
    return decision;
  }

  /** The decision itself. Split from `resolve` only so recording the result has one place to live. */
  private decide(actor: Actor, dt: number): AnimationDecision {
    let memory = this.memory.get(actor.id);
    if (!memory) {
      memory = freshMemory(actor);
      this.memory.set(actor.id, memory);
    }

    const speed = speedXZ(actor.velocity);
    const wasGrounded = memory.grounded;
    const previousAirTime = memory.airTime;
    const interactRequest = memory.interactRequest;
    memory.interactRequest = 0;

    // Advance timers before anything reads them, so a hold of one frame lasts one frame.
    if (memory.holdLeft > 0) memory.holdLeft = Math.max(0, memory.holdLeft - dt);
    if (memory.turnHoldLeft > 0) memory.turnHoldLeft = Math.max(0, memory.turnHoldLeft - dt);

    // Snapshot this frame's simulation state for the next call's edge detection. Done up front so
    // every early return below still leaves the memory consistent.
    memory.grounded = actor.grounded;
    memory.airTime = actor.airTime;

    const turnSign = this.updateTurn(memory, actor, speed);

    if (!actor.alive) {
      // Death is not an event with a hold, it is a condition: the actor stays dead until it
      // respawns. Clear anything in flight so a respawn does not resume a landing.
      memory.holdLeft = 0;
      memory.holdState = '';
      memory.turning = false;
      const once = memory.alive;
      memory.alive = false;
      return { state: 'death', once, turnSign: 0 };
    }
    const wasDead = !memory.alive;
    memory.alive = true;
    if (wasDead) {
      memory.tier = 0;
      memory.holdLeft = 0;
      memory.holdState = '';
    }

    // Airborne outranks everything. It also cancels holds: a landing interrupted by another jump is
    // over, and an interaction cannot survive its actor leaving the ground.
    // Gated on `airTime`, not on `grounded` alone — see AIRBORNE. A brief loss of ground contact
    // leaves the actor in whatever ground state it had, which is what it looks like.
    if (!actor.grounded && actor.airTime >= AIRBORNE.minTime) {
      memory.holdLeft = 0;
      memory.holdState = '';
      memory.tier = Math.min(memory.tier, 2);
      return { state: actor.velocity.y > 0.5 ? 'jump' : 'fall', once: false, turnSign };
    }

    // The landing edge. `airTime` is zeroed the moment the actor is grounded, so the qualifying
    // duration is the value carried over from the previous frame, not this one.
    const landed = !wasGrounded && previousAirTime >= LANDING.minAirTime;
    if (landed) {
      memory.holdLeft = LANDING.hold;
      memory.holdState = 'landing';
      // A landing straight into a slide is a slide; the stance check below takes it.
    }

    if (actor.stance === 'slide') {
      memory.holdLeft = 0;
      memory.holdState = '';
      memory.tier = 3;
      return { state: 'slide', once: false, turnSign };
    }

    if (memory.holdState === 'landing') {
      // Released early once the player is clearly moving again, so recovery never fights input.
      if (memory.holdLeft > 0 && speed < LANDING.breakSpeed) {
        return { state: 'landing', once: landed, turnSign };
      }
      memory.holdLeft = 0;
      memory.holdState = '';
    }

    if (actor.stance === 'crouch') {
      memory.tier = Math.min(memory.tier, 1);
      return { state: 'crouch', once: false, turnSign };
    }

    if (interactRequest > 0 && speed < TIER_ENTER[1]) {
      memory.holdLeft = interactRequest;
      memory.holdState = 'interact';
      return { state: 'interact', once: true, turnSign };
    }
    if (memory.holdState === 'interact') {
      if (memory.holdLeft > 0 && speed < TIER_ENTER[1]) {
        return { state: 'interact', once: false, turnSign };
      }
      memory.holdLeft = 0;
      memory.holdState = '';
    }

    const tier = this.updateTier(memory, speed);

    // A turn only shows while the actor is otherwise standing still. Turning at speed is already
    // legible from the run cycle changing direction, and a turn-in-place clip layered over it reads
    // as a stumble.
    if (memory.turning && tier === 0) {
      return { state: 'turning', once: false, turnSign };
    }

    return { state: LOCOMOTION_TIERS[tier], once: false, turnSign };
  }

  /** Climbs and descends the speed tiers one step at a time, respecting the dead bands. */
  private updateTier(memory: ActorMemory, speed: number): number {
    let tier = memory.tier;
    while (tier < LOCOMOTION_TIERS.length - 1 && speed >= TIER_ENTER[tier + 1]) tier++;
    while (tier > 0 && speed < TIER_EXIT[tier]) tier--;
    memory.tier = tier;
    return tier;
  }

  /** Yaw-rate threshold with a hold floor. Returns the signed direction for mirroring. */
  private updateTurn(memory: ActorMemory, actor: Actor, speed: number): -1 | 0 | 1 {
    const rate = angleDelta(actor.prevYaw, actor.yaw) / TICK_DT;
    const magnitude = Math.abs(rate);

    if (magnitude >= TURN.enter) {
      memory.turning = true;
      memory.turnHoldLeft = TURN.hold;
      // Positive yaw turns **left** in this engine — `forwardFromLook` says so and `groundBasis`
      // agrees, and it is the opposite of what "positive means clockwise" instinct suggests. Getting
      // it backwards would have mirrored every turn, which is not a crash and not obvious in a
      // screenshot: it looks like a turn, just the wrong one.
      memory.turnSign = rate > 0 ? -1 : 1;
    } else if (memory.turning && magnitude < TURN.exit && memory.turnHoldLeft <= 0) {
      memory.turning = false;
      memory.turnSign = 0;
    }

    // Moving cancels the turn outright rather than waiting out the hold: a player who turns and
    // immediately runs should get the run cycle on the frame they start moving.
    if (speed >= TIER_ENTER[1] && memory.turning) {
      memory.turning = false;
      memory.turnHoldLeft = 0;
      memory.turnSign = 0;
    }

    return memory.turnSign;
  }
}

/**
 * The mapper the renderer uses.
 *
 * A module singleton rather than a component ref so that gameplay-adjacent code can request an
 * interaction animation without a handle on the React tree. Tests construct their own instances.
 */
export const characterStates = new CharacterStateMapper();

/** Convenience re-export, so a future arena-service system needs one import and one call. */
export function triggerInteract(actorId: number, duration?: number): void {
  characterStates.triggerInteract(actorId, duration);
}

/** Thresholds, exported so tests assert against the derivation rather than copies of the numbers. */
export const STATE_THRESHOLDS = {
  TIER_ENTER, TIER_EXIT, TURN, LANDING, AIRBORNE, INTERACT_DEFAULT_HOLD,
} as const;
