import { NavGraph } from '../src/ai/NavGraph';
import { defaultMatchSettings } from '../src/config/gameModes';
import { EventBus } from '../src/engine/EventBus';
import { TICK_DT } from '../src/engine/GameLoop';
import { MatchDirector } from '../src/gameplay/MatchDirector';
import { stepMovement } from '../src/gameplay/MovementSystem';
import type { Actor, GameEvents } from '../src/gameplay/types';
import { createInputFrame, type InputFrame } from '../src/input/InputFrame';
import { buildArena, getArena } from '../src/maps/MapBuilder';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { dist3 } from '../src/util/math';

/**
 * A/B harness for prediction fidelity.
 *
 * The client's reconciler replays unacknowledged input through `stepMovement` alone, while the live
 * simulation runs the full `MatchDirector.step()` — movement, weapons, triggers, props, then
 * `physics.step()`. If those two paths do not produce byte-identical motion for identical input,
 * the client will disagree with the server on *every* snapshot no matter how good the network is,
 * which is exactly the 14-21 corrections/second the multi-client test measured.
 *
 * This builds two worlds from the same seed, feeds them the same scripted inputs, steps one through
 * each path, and reports the first tick where they diverge and by how much.
 *
 * Three hypotheses were already tested and rejected against the live system (quantisation noise,
 * tolerance below the noise floor, client/server tick-clock coupling). This isolates the remaining
 * one under laboratory conditions instead of guessing.
 *
 *   npm run predict-ab
 */

interface World {
  physics: PhysicsWorld;
  director: MatchDirector;
  events: EventBus<GameEvents>;
  actor: Actor;
}

async function buildWorld(seed: number, withBots: boolean): Promise<World> {
  await initPhysics();
  const physics = new PhysicsWorld();
  const settings = { ...defaultMatchSettings(), seed, botsEnabled: withBots, botsPerTeam: withBots ? 3 : 1 };
  const definition = getArena(settings.arena);
  buildArena(physics, definition);
  const nav = NavGraph.build(physics, definition);
  const events = new EventBus<GameEvents>();
  const director = new MatchDirector(settings, definition, physics, nav, events);
  const actor = director.createLocalPlayer('SUBJECT');
  if (withBots) director.populateBots();
  return { physics, director, events, actor };
}

/** Deterministic input script: movement, sprinting, jumping, and a slide. */
function scriptedInput(tick: number): InputFrame {
  const frame = createInputFrame();
  frame.tick = tick;
  frame.moveZ = 1;
  frame.moveX = Math.sin(tick / 37) * 0.8;
  frame.sprint = tick % 200 < 140;
  frame.jump = tick % 97 === 0;
  frame.jumpPressed = tick % 97 === 0;
  frame.crouch = tick % 211 > 195;
  frame.crouchPressed = tick % 211 === 196;
  frame.lookYaw = Math.sin(tick / 91) * 0.01;
  return frame;
}

function place(world: World, x: number, z: number): void {
  const a = world.actor;
  a.position.x = x;
  a.position.y = 0.2;
  a.position.z = z;
  a.velocity.x = a.velocity.y = a.velocity.z = 0;
  a.yaw = 0;
  a.pitch = 0;
  world.physics.setCharacterPosition(a.bodyHandle, {
    x,
    y: a.position.y + a.height * 0.5,
    z,
  });
}

interface Divergence {
  label: string;
  firstDivergenceTick: number;
  firstDivergenceMetres: number;
  finalErrorMetres: number;
  maxErrorMetres: number;
  meanErrorMetres: number;
}

/**
 * Runs the same input through the full director path (A) and the reconciler's replay path (B).
 * `withBots` controls whether other actors exist, isolating actor-vs-actor collision as a variable.
 */
async function compare(label: string, ticks: number, withBots: boolean): Promise<Divergence> {
  const a = await buildWorld(4242, withBots);
  const b = await buildWorld(4242, withBots);
  place(a, -20, -2);
  place(b, -20, -2);

  let firstDivergenceTick = -1;
  let firstDivergenceMetres = 0;
  let maxError = 0;
  let totalError = 0;

  for (let tick = 0; tick < ticks; tick++) {
    const input = scriptedInput(tick);

    // Path A: the live simulation, exactly as the server and the local client run it.
    Object.assign(a.actor.input, input);
    a.director.step(TICK_DT);

    // Path B: the reconciler's replay path — stepMovement alone, no physics.step, no other systems.
    Object.assign(b.actor.input, input);
    stepMovement(b.actor, b.physics, TICK_DT, b.events);

    const error = dist3(a.actor.position, b.actor.position);
    totalError += error;
    if (error > maxError) maxError = error;
    if (firstDivergenceTick < 0 && error > 0.001) {
      firstDivergenceTick = tick;
      firstDivergenceMetres = error;
    }
  }

  return {
    label,
    firstDivergenceTick,
    firstDivergenceMetres: round(firstDivergenceMetres),
    finalErrorMetres: round(dist3(a.actor.position, b.actor.position)),
    maxErrorMetres: round(maxError),
    meanErrorMetres: round(totalError / ticks),
  };
}

/**
 * Isolates `physics.step()` specifically: path B gets stepMovement *plus* a physics step, which is
 * the only remaining difference from path A once other actors are removed.
 */
async function compareWithPhysicsStep(ticks: number): Promise<Divergence> {
  const a = await buildWorld(4242, false);
  const b = await buildWorld(4242, false);
  place(a, -20, -2);
  place(b, -20, -2);

  let firstDivergenceTick = -1;
  let firstDivergenceMetres = 0;
  let maxError = 0;
  let totalError = 0;

  for (let tick = 0; tick < ticks; tick++) {
    const input = scriptedInput(tick);
    Object.assign(a.actor.input, input);
    a.director.step(TICK_DT);

    Object.assign(b.actor.input, input);
    stepMovement(b.actor, b.physics, TICK_DT, b.events);
    b.physics.step();

    const error = dist3(a.actor.position, b.actor.position);
    totalError += error;
    if (error > maxError) maxError = error;
    if (firstDivergenceTick < 0 && error > 0.001) {
      firstDivergenceTick = tick;
      firstDivergenceMetres = error;
    }
  }

  return {
    label: 'stepMovement + physics.step, no other actors',
    firstDivergenceTick,
    firstDivergenceMetres: round(firstDivergenceMetres),
    finalErrorMetres: round(dist3(a.actor.position, b.actor.position)),
    maxErrorMetres: round(maxError),
    meanErrorMetres: round(totalError / ticks),
  };
}

const round = (v: number) => Math.round(v * 100000) / 100000;

function report(d: Divergence): void {
  const verdict =
    d.maxErrorMetres < 0.001
      ? 'IDENTICAL'
      : d.maxErrorMetres < 0.05
        ? 'close'
        : 'DIVERGENT';
  console.log(
    `\n  ${d.label}\n` +
      `    first divergence   ${d.firstDivergenceTick < 0 ? 'never' : `tick ${d.firstDivergenceTick} (${d.firstDivergenceMetres} m)`}\n` +
      `    mean error         ${d.meanErrorMetres} m\n` +
      `    max error          ${d.maxErrorMetres} m\n` +
      `    final error        ${d.finalErrorMetres} m\n` +
      `    verdict            ${verdict}`,
  );
}

async function main(): Promise<void> {
  const ticks = 640; // ten seconds
  console.log('[predict-ab] comparing live simulation against reconciler replay path');
  console.log(`[predict-ab] ${ticks} ticks of identical scripted input per run`);

  const solo = await compare('stepMovement only, no other actors', ticks, false);
  report(solo);

  const withPhysics = await compareWithPhysicsStep(ticks);
  report(withPhysics);

  const crowded = await compare('stepMovement only, 6 actors present', ticks, true);
  report(crowded);

  console.log('\n[predict-ab] ===== CONCLUSION =====');
  if (solo.maxErrorMetres < 0.001) {
    console.log('  stepMovement alone reproduces the live path exactly with no other actors.');
  } else {
    console.log(
      `  stepMovement alone DIVERGES even with no other actors (max ${solo.maxErrorMetres} m).\n` +
        '  The replay path is not equivalent to the live path in isolation.',
    );
  }
  if (withPhysics.maxErrorMetres < solo.maxErrorMetres * 0.5) {
    console.log('  Adding physics.step() to the replay path materially reduces divergence.');
  } else if (Math.abs(withPhysics.maxErrorMetres - solo.maxErrorMetres) < 0.001) {
    console.log('  physics.step() makes no difference — it is not the cause.');
  }
  if (crowded.maxErrorMetres > solo.maxErrorMetres * 2) {
    console.log('  Other actors materially increase divergence — actor collision is implicated.');
  }
  console.log('');
}

main().catch((error) => {
  console.error('[predict-ab] fatal:', error);
  process.exit(1);
});
