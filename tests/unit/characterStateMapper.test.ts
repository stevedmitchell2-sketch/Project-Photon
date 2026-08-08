import { beforeEach, describe, expect, it } from 'vitest';
import { MOVEMENT } from '@/config/movement';
import { TICK_DT } from '@/engine/GameLoop';
import type { Actor } from '@/gameplay/types';
import { CharacterStateMapper, STATE_THRESHOLDS } from '@/render/CharacterStateMapper';

/**
 * The animation state mapper.
 *
 * Four states — sprint, landing, turning, interact — resolved to clips for a whole sprint before
 * anything produced them, which is a failure mode worth spelling out: nothing throws, nothing logs,
 * the character animates, and the states simply never occur. So these tests assert on the *state
 * names produced*, not on whether the code runs.
 *
 * A render frame is 1/60 s here. The mapper's hold timers run on render delta, and its thresholds
 * read instantaneous simulation state, so the two rates are deliberately different.
 */

const FRAME = 1 / 60;

function makeActor(over: Partial<Actor> = {}): Actor {
  return {
    id: 1,
    alive: true,
    grounded: true,
    airTime: 0,
    stance: 'stand',
    yaw: 0,
    prevYaw: 0,
    velocity: { x: 0, y: 0, z: 0 },
    ...over,
  } as unknown as Actor;
}

/** An actor moving flat at `speed` m/s. */
function moving(speed: number, over: Partial<Actor> = {}): Actor {
  return makeActor({ velocity: { x: 0, y: 0, z: -speed }, ...over });
}

/** Yaw pair producing a given rate in rad/s over one simulation tick. */
function turningAt(rate: number, over: Partial<Actor> = {}): Actor {
  return makeActor({ prevYaw: 0, yaw: rate * TICK_DT, ...over });
}

/** Runs the mapper for `frames` frames on the same actor and returns the last state. */
function settle(mapper: CharacterStateMapper, actor: Actor, frames: number): string {
  let state = '';
  for (let i = 0; i < frames; i++) state = mapper.resolve(actor, FRAME).state;
  return state;
}

let mapper: CharacterStateMapper;
beforeEach(() => {
  mapper = new CharacterStateMapper();
});

describe('locomotion tiers', () => {
  it('preserves idle and walk at the speeds that produced them before', () => {
    expect(mapper.resolve(moving(0), FRAME).state).toBe('idle');
    expect(mapper.resolve(moving(0.5), FRAME).state).toBe('walk');
  });

  it('runs at normal movement speed and sprints at sprint speed', () => {
    // The whole point of the pass. Under the old single threshold of 6 m/s, `walkSpeed` (5.2) was
    // below it and produced `walk`, so the run clip only ever played while sprinting.
    const walker = new CharacterStateMapper();
    expect(settle(walker, moving(MOVEMENT.walkSpeed), 4)).toBe('run');

    const sprinter = new CharacterStateMapper();
    expect(settle(sprinter, moving(MOVEMENT.sprintSpeed), 4)).toBe('sprint');
  });

  it('puts the sprint boundary between the two configured speeds', () => {
    // Derived rather than written down, so retuning movement cannot silently strand a state.
    const enter = STATE_THRESHOLDS.TIER_ENTER[3];
    const exit = STATE_THRESHOLDS.TIER_EXIT[3];
    expect(enter).toBeGreaterThan(MOVEMENT.walkSpeed);
    expect(enter).toBeLessThan(MOVEMENT.sprintSpeed);
    expect(exit).toBeLessThan(enter);
    expect(exit).toBeGreaterThan(MOVEMENT.walkSpeed);
  });

  it('does not flicker between run and sprint at the boundary', () => {
    // A player sprinting into a slope oscillates around one number. Without a dead band that is
    // several cross-fades a second, which is more visible than being one tier "wrong".
    const enter = STATE_THRESHOLDS.TIER_ENTER[3];
    settle(mapper, moving(MOVEMENT.sprintSpeed), 3);
    expect(mapper.tierOf(1)).toBe('sprint');

    const states = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const speed = enter - (i % 2 === 0 ? 0.05 : -0.05);
      states.add(mapper.resolve(moving(speed), FRAME).state);
    }
    expect([...states]).toEqual(['sprint']);
  });

  it('drops out of sprint once clearly slower', () => {
    settle(mapper, moving(MOVEMENT.sprintSpeed), 3);
    expect(settle(mapper, moving(MOVEMENT.walkSpeed), 3)).toBe('run');
  });

  it('keeps stance ahead of speed', () => {
    expect(mapper.resolve(moving(MOVEMENT.sprintSpeed, { stance: 'slide' }), FRAME).state).toBe('slide');
    expect(mapper.resolve(moving(2, { stance: 'crouch' }), FRAME).state).toBe('crouch');
  });
});

describe('landing', () => {
  /** Airborne for `airTime` seconds, then a touchdown. Returns the touchdown decision. */
  function land(m: CharacterStateMapper, airTime: number, speed = 0) {
    m.resolve(makeActor({ grounded: false, airTime, velocity: { x: 0, y: -6, z: 0 } }), FRAME);
    return m.resolve(moving(speed), FRAME);
  }

  it('fires once on the grounded transition after a real fall', () => {
    const decision = land(mapper, 0.6);
    expect(decision.state).toBe('landing');
    expect(decision.once).toBe(true);
  });

  it('ignores a one-tick grounded flicker', () => {
    // `grounded` drops for a single tick whenever a player crosses a step or a ramp seam. Treating
    // that as a landing restarts an impact animation several times a second while simply walking.
    expect(land(mapper, 0.05).state).not.toBe('landing');
  });

  it('does not re-arm the one-shot while held', () => {
    expect(land(mapper, 0.6).once).toBe(true);
    const next = mapper.resolve(moving(0), FRAME);
    expect(next.state).toBe('landing');
    expect(next.once).toBe(false);
  });

  it('returns to locomotion when the hold expires', () => {
    land(mapper, 0.6);
    const frames = Math.ceil(STATE_THRESHOLDS.LANDING.hold / FRAME) + 2;
    expect(settle(mapper, moving(0), frames)).toBe('idle');
  });

  it('plays through a run, and is skipped only at sprint', () => {
    // A live sample of five bots produced 3 landings in 20 seconds, one of them at 3.71 m/s and only
    // just under the original gate: players almost always land moving, so a gate near walking speed
    // made the state unreachable in normal play.
    const runner = new CharacterStateMapper();
    expect(land(runner, 0.6, MOVEMENT.walkSpeed).state).toBe('landing');
  });

  it('breaks out early when the player is already moving again', () => {
    // Recovery must never fight input. Holding the full absorb would leave the mesh crouched while
    // the collision capsule ran away from it.
    const decision = land(mapper, 0.6, MOVEMENT.sprintSpeed);
    expect(decision.state).not.toBe('landing');
  });

  it('is cancelled by leaving the ground again', () => {
    // Airborne long enough to clear the airborne gate but not the landing gate, so the touchdown
    // cannot be mistaken for a fresh landing — what is being asserted is that the *first* landing's
    // hold was abandoned, not that no landing can follow a hop.
    const brief = 0.1;
    expect(brief).toBeGreaterThan(STATE_THRESHOLDS.AIRBORNE.minTime);
    expect(brief).toBeLessThan(STATE_THRESHOLDS.LANDING.minAirTime);

    land(mapper, 0.6);
    expect(mapper.resolve(makeActor({ grounded: false, airTime: brief, velocity: { x: 0, y: 5, z: 0 } }), FRAME).state)
      .toBe('jump');
    expect(mapper.resolve(moving(0), FRAME).state).toBe('idle');
  });

  it('ignores a single-tick loss of ground contact', () => {
    // Measured on Apex: `grounded` drops for one tick at ramp seams, step lips and bridge joints,
    // once at 9.53 m/s. Ungated, each one is a cross-fade into a falling clip and straight back out.
    const m = new CharacterStateMapper();
    settle(m, moving(MOVEMENT.walkSpeed), 4);
    const blip = makeActor({
      grounded: false,
      airTime: TICK_DT,
      velocity: { x: 0, y: -0.4, z: -MOVEMENT.walkSpeed },
    });
    expect(m.resolve(blip, FRAME).state).toBe('run');
  });

  it('still reports a real jump promptly', () => {
    // The gate must not become a delay anyone can see. A real jump clears it within a few ticks.
    const m = new CharacterStateMapper();
    settle(m, moving(0), 2);
    const airborne = makeActor({
      grounded: false,
      airTime: STATE_THRESHOLDS.AIRBORNE.minTime,
      velocity: { x: 0, y: 5, z: 0 },
    });
    expect(m.resolve(airborne, FRAME).state).toBe('jump');
    expect(STATE_THRESHOLDS.AIRBORNE.minTime).toBeLessThan(STATE_THRESHOLDS.LANDING.minAirTime);
  });

  it('yields to a slide landing', () => {
    mapper.resolve(makeActor({ grounded: false, airTime: 0.6, velocity: { x: 0, y: -6, z: 0 } }), FRAME);
    expect(mapper.resolve(moving(9, { stance: 'slide' }), FRAME).state).toBe('slide');
  });
});

describe('turning', () => {
  it('drives turning above the yaw-rate threshold', () => {
    expect(mapper.resolve(turningAt(STATE_THRESHOLDS.TURN.enter + 0.4), FRAME).state).toBe('turning');
  });

  it('ignores a slow head correction', () => {
    expect(mapper.resolve(turningAt(STATE_THRESHOLDS.TURN.enter - 0.5), FRAME).state).toBe('idle');
  });

  it('signs the direction for mirroring, with left positive in engine yaw', () => {
    // `forwardFromLook` documents positive yaw as turning left. A flipped sign here mirrors every
    // turn, which still looks like a turn and so never gets caught by eye.
    const left = new CharacterStateMapper();
    expect(left.resolve(turningAt(3), FRAME).turnSign).toBe(-1);
    const right = new CharacterStateMapper();
    expect(right.resolve(turningAt(-3), FRAME).turnSign).toBe(1);
  });

  it('holds through a flick instead of chattering', () => {
    // One frame over the threshold, then nothing. Without the hold floor that is a cross-fade in and
    // straight back out, which reads as a twitch.
    mapper.resolve(turningAt(4), FRAME);
    expect(mapper.resolve(turningAt(0), FRAME).state).toBe('turning');
    const frames = Math.ceil(STATE_THRESHOLDS.TURN.hold / FRAME) + 2;
    expect(settle(mapper, turningAt(0), frames)).toBe('idle');
  });

  it('gives way to locomotion the moment the actor moves', () => {
    // Turning at speed is already legible from the run cycle changing heading; a turn-in-place clip
    // layered over it reads as a stumble.
    mapper.resolve(turningAt(4), FRAME);
    expect(mapper.resolve(moving(MOVEMENT.walkSpeed, { prevYaw: 0, yaw: 4 * TICK_DT }), FRAME).state).toBe('run');
  });

  it('measures the rate against the tick, not the frame', () => {
    // `prevYaw` is one simulation tick old however many frames the renderer drew, so the rate must
    // not depend on frame delta.
    const fast = new CharacterStateMapper();
    const slow = new CharacterStateMapper();
    const actor = turningAt(4);
    expect(fast.resolve(actor, 1 / 240).state).toBe(slow.resolve(actor, 1 / 30).state);
  });
});

describe('interact', () => {
  it('plays once when triggered on a stationary actor', () => {
    mapper.resolve(moving(0), FRAME);
    mapper.triggerInteract(1);
    const decision = mapper.resolve(moving(0), FRAME);
    expect(decision.state).toBe('interact');
    expect(decision.once).toBe(true);
  });

  it('holds for its duration then releases', () => {
    mapper.resolve(moving(0), FRAME);
    mapper.triggerInteract(1, 0.2);
    expect(mapper.resolve(moving(0), FRAME).state).toBe('interact');
    expect(settle(mapper, moving(0), Math.ceil(0.2 / FRAME) + 2)).toBe('idle');
  });

  it('is dropped for a moving actor', () => {
    // A button-press animation on a character sprinting past is worse than no animation.
    mapper.resolve(moving(MOVEMENT.sprintSpeed), FRAME);
    mapper.triggerInteract(1);
    expect(mapper.resolve(moving(MOVEMENT.sprintSpeed), FRAME).state).not.toBe('interact');
  });

  it('is abandoned when the actor moves off mid-animation', () => {
    mapper.resolve(moving(0), FRAME);
    mapper.triggerInteract(1);
    expect(mapper.resolve(moving(0), FRAME).state).toBe('interact');
    expect(mapper.resolve(moving(MOVEMENT.walkSpeed), FRAME).state).toBe('run');
  });

  it('is abandoned when the actor leaves the ground', () => {
    mapper.resolve(moving(0), FRAME);
    mapper.triggerInteract(1);
    mapper.resolve(moving(0), FRAME);
    expect(mapper.resolve(makeActor({ grounded: false, airTime: 0.1, velocity: { x: 0, y: 5, z: 0 } }), FRAME).state)
      .toBe('jump');
    expect(mapper.resolve(moving(0), FRAME).state).toBe('idle');
  });

  it('ignores a trigger for an actor that is not being drawn', () => {
    // Queueing it would fire the animation at whatever arbitrary later moment the actor first
    // appears on screen.
    mapper.triggerInteract(99);
    expect(mapper.resolve(makeActor({ id: 99 }), FRAME).state).toBe('idle');
  });

  it('carries no gameplay meaning', () => {
    // The brief: expose a trigger, do not invent behaviour. The only observable effect of a trigger
    // is the state name, and the simulation never reads it.
    const actor = moving(0);
    mapper.resolve(actor, FRAME);
    const before = JSON.stringify(actor);
    mapper.triggerInteract(1);
    mapper.resolve(actor, FRAME);
    expect(JSON.stringify(actor)).toBe(before);
  });
});

describe('simulation safety', () => {
  it('never writes to the actor it is given', () => {
    // Animation reading simulation is the contract; animation writing to it is the bug this guards.
    // A frozen actor turns any assignment into a thrown TypeError under strict mode.
    const actor = Object.freeze(
      makeActor({ velocity: Object.freeze({ x: 0, y: 0, z: -MOVEMENT.sprintSpeed }) as never }),
    );
    for (let i = 0; i < 8; i++) expect(() => mapper.resolve(actor, FRAME)).not.toThrow();
  });

  it('produces the same states for identical simulation input', () => {
    // Two clients see the same replicated numbers, so they must reach the same states. This is what
    // makes an animation disagreement impossible rather than merely unlikely.
    const script: Actor[] = [
      moving(0),
      turningAt(4),
      moving(MOVEMENT.walkSpeed),
      moving(MOVEMENT.sprintSpeed),
      makeActor({ grounded: false, airTime: 0.4, velocity: { x: 0, y: -6, z: 0 } }),
      moving(0),
      moving(0),
      moving(2),
    ];
    const run = (m: CharacterStateMapper) => script.map((a) => m.resolve(a, FRAME).state).join(',');
    expect(run(new CharacterStateMapper())).toBe(run(new CharacterStateMapper()));
  });

  it('forgets a released actor so a rejoining id starts clean', () => {
    settle(mapper, moving(MOVEMENT.sprintSpeed), 4);
    expect(mapper.tierOf(1)).toBe('sprint');
    mapper.release(1);
    expect(mapper.tierOf(1)).toBeNull();
    expect(mapper.resolve(moving(MOVEMENT.walkSpeed), FRAME).state).not.toBe('sprint');
  });

  it('reports death and clears anything in flight', () => {
    mapper.resolve(moving(0), FRAME);
    mapper.triggerInteract(1);
    mapper.resolve(moving(0), FRAME);
    const dead = mapper.resolve(makeActor({ alive: false }), FRAME);
    expect(dead.state).toBe('death');
    expect(dead.once).toBe(true);
    // A respawn must not resume the interrupted animation.
    expect(mapper.resolve(moving(0), FRAME).state).toBe('idle');
  });
});
