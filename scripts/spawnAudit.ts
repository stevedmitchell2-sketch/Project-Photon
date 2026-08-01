import { NavGraph } from '../src/ai/NavGraph';
import { COMBAT } from '../src/config/combat';
import { defaultMatchSettings } from '../src/config/gameModes';
import { EventBus } from '../src/engine/EventBus';
import { TICK_DT } from '../src/engine/GameLoop';
import { MatchDirector } from '../src/gameplay/MatchDirector';
import type { GameEvents } from '../src/gameplay/types';
import { buildArena, getArena } from '../src/maps/MapBuilder';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { dist3 } from '../src/util/math';

/**
 * Spawn fairness audit.
 *
 * The Sprint 7 playtest produced one finding above all others: you die roughly ten seconds after
 * every spawn. That is a symptom with at least three plausible causes, and they have opposite fixes:
 *
 *   1. spawns are placed near live combat — fix the spawn scoring;
 *   2. bots acquire and land shots faster than a player can orient — fix bot difficulty;
 *   3. time-to-kill is simply very short — fix the combat numbers.
 *
 * Tuning them together makes the result impossible to attribute, so this measures each separately
 * from a real headless bot match. Nothing here is a special test path: it runs the same
 * `MatchDirector` the game and the server run, and observes it through the ordinary event stream.
 *
 *   npm run spawn-audit -- --seconds 180 --bots 6
 *   npm run spawn-audit -- --seconds 180 --bots 6 --difficulty easy
 */

interface Life {
  actorId: number;
  spawnTime: number;
  spawnPos: { x: number; y: number; z: number };
  /** Distance to the closest living enemy at the instant of spawning. */
  nearestEnemyAtSpawn: number;
  /** Whether any living enemy had line of sight to this spawn at the instant of spawning. */
  enemyLosAtSpawn: boolean;
  /** Match time of the first damage taken this life, or null if never damaged. */
  firstDamageTime: number | null;
  /** Distance to the attacker on that first damage. */
  firstDamageRange: number | null;
  deathTime: number | null;
  killerRange: number | null;
}

function parseArgs(argv: string[]) {
  let seconds = 180;
  let bots = 6;
  let difficulty = 'medium';
  let seed = 1337;
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    const value = argv[i + 1];
    if (key === 'seconds') seconds = Number(value) || seconds;
    if (key === 'bots') bots = Number(value) || bots;
    if (key === 'difficulty') difficulty = value ?? difficulty;
    if (key === 'seed') seed = Number(value) || seed;
  }
  return { seconds, bots, difficulty, seed };
}

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

const median = (values: number[]): number => percentile([...values].sort((a, b) => a - b), 0.5);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await initPhysics();
  const physics = new PhysicsWorld();
  const settings = defaultMatchSettings();
  settings.botsEnabled = true;
  settings.botsPerTeam = args.bots;
  settings.botDifficulty = args.difficulty as typeof settings.botDifficulty;
  settings.seed = args.seed;
  // A long match so the score limit does not end it before enough lives are sampled.
  settings.scoreLimit = 100000;
  settings.timeLimitSeconds = args.seconds + 60;

  const definition = getArena(settings.arena);
  buildArena(physics, definition);
  const nav = NavGraph.build(physics, definition);
  const events = new EventBus<GameEvents>();
  const director = new MatchDirector(settings, definition, physics, nav, events);
  director.populateBots();

  const lives = new Map<number, Life>();
  const completed: Life[] = [];
  let shots = 0;
  let hits = 0;

  /** Snapshot of the tactical situation at a position, from the authoritative world. */
  const situation = (actorId: number, team: string, position: { x: number; y: number; z: number }) => {
    let nearest = Infinity;
    let los = false;
    const eye = { x: position.x, y: position.y + 1.6, z: position.z };
    for (const other of director.state.actors.values()) {
      if (other.id === actorId || !other.alive || other.team === team) continue;
      nearest = Math.min(nearest, dist3(position, other.position));
      if (!los) {
        const otherEye = { x: other.position.x, y: other.position.y + other.height * 0.9, z: other.position.z };
        if (physics.hasLineOfSight(eye, otherEye)) los = true;
      }
    }
    return { nearest: Number.isFinite(nearest) ? nearest : -1, los };
  };

  const beginLife = (actorId: number, team: string, position: { x: number; y: number; z: number }) => {
    const s = situation(actorId, team, position);
    lives.set(actorId, {
      actorId,
      spawnTime: director.state.time,
      spawnPos: { ...position },
      nearestEnemyAtSpawn: s.nearest,
      enemyLosAtSpawn: s.los,
      firstDamageTime: null,
      firstDamageRange: null,
      deathTime: null,
      killerRange: null,
    });
  };

  events.on('actor_spawned', (e) => beginLife(e.actorId, e.team, e.position));
  events.on('shot_fired', () => shots++);

  events.on('damage_dealt', (e) => {
    hits++;
    const life = lives.get(e.victimId);
    if (!life || life.firstDamageTime !== null) return;
    const attacker = director.state.actors.get(e.attackerId);
    const victim = director.state.actors.get(e.victimId);
    life.firstDamageTime = director.state.time;
    life.firstDamageRange = attacker && victim ? dist3(attacker.position, victim.position) : null;
  });

  events.on('actor_died', (e) => {
    const life = lives.get(e.actorId);
    if (!life) return;
    const killer = director.state.actors.get(e.killerId);
    const victim = director.state.actors.get(e.actorId);
    life.deathTime = director.state.time;
    life.killerRange = killer && victim ? dist3(killer.position, victim.position) : null;
    completed.push(life);
    lives.delete(e.actorId);
  });

  // Seed the first life of every actor: `respawn(initial)` deliberately does not emit, because at
  // match start nothing is listening yet and a spawn event before the match exists is noise.
  for (const actor of director.state.actors.values()) {
    beginLife(actor.id, actor.team, actor.position);
  }

  console.log(
    `[spawn-audit] ${args.bots} per team, ${args.difficulty} bots, ${args.seconds}s, seed ${args.seed}`,
  );
  const totalTicks = args.seconds * 64;
  const startedAt = Date.now();
  for (let tick = 0; tick < totalTicks; tick++) director.step(TICK_DT);
  const wall = (Date.now() - startedAt) / 1000;

  // --- Analysis ------------------------------------------------------------
  const finished = completed.filter((l) => l.deathTime !== null);
  const lifetimes = finished.map((l) => l.deathTime! - l.spawnTime);
  const sortedLifetimes = [...lifetimes].sort((a, b) => a - b);

  // Time-to-kill: first damage taken to death. This is the combat pace, independent of how long it
  // took anyone to find each other.
  const ttks = finished
    .filter((l) => l.firstDamageTime !== null)
    .map((l) => l.deathTime! - l.firstDamageTime!);

  // Time-to-contact: spawn to first damage. This is the spawn placement measure.
  const contacts = finished
    .filter((l) => l.firstDamageTime !== null)
    .map((l) => l.firstDamageTime! - l.spawnTime);

  const spawnDistances = finished.map((l) => l.nearestEnemyAtSpawn).filter((d) => d >= 0);
  const losSpawns = finished.filter((l) => l.enemyLosAtSpawn).length;
  const engagementRanges = finished.map((l) => l.killerRange).filter((d): d is number => d !== null);

  const under = (t: number) => lifetimes.filter((l) => l < t).length;
  const pct = (n: number) => `${Math.round((n / Math.max(1, finished.length)) * 1000) / 10}%`;

  console.log(`\n[spawn-audit] simulated ${args.seconds}s in ${wall.toFixed(1)}s, ${finished.length} completed lives\n`);

  console.log('  LIFETIME (spawn to death)');
  console.log(`    median            ${median(lifetimes).toFixed(1)} s`);
  console.log(`    p10 / p90         ${percentile(sortedLifetimes, 0.1).toFixed(1)} s / ${percentile(sortedLifetimes, 0.9).toFixed(1)} s`);
  console.log(`    under 5 s         ${under(5)} (${pct(under(5))})`);
  console.log(`    under 10 s        ${under(10)} (${pct(under(10))})`);
  console.log(`    under 15 s        ${under(15)} (${pct(under(15))})`);

  console.log('\n  SPAWN PLACEMENT');
  console.log(`    median nearest enemy at spawn   ${median(spawnDistances).toFixed(1)} m`);
  console.log(`    spawns within 15 m of an enemy  ${pct(spawnDistances.filter((d) => d < 15).length)}`);
  console.log(`    spawns with enemy line of sight ${losSpawns} (${pct(losSpawns)})`);
  console.log(`    median spawn to first damage    ${median(contacts).toFixed(1)} s`);
  console.log(`    damaged within 3 s of spawning  ${pct(contacts.filter((c) => c < 3).length)}`);

  console.log('\n  COMBAT PACE');
  console.log(`    median time to kill             ${median(ttks).toFixed(2)} s  (first damage taken to death)`);
  console.log(`    p90 time to kill                ${percentile([...ttks].sort((a, b) => a - b), 0.9).toFixed(2)} s`);
  console.log(`    median engagement range         ${median(engagementRanges).toFixed(1)} m`);
  console.log(`    bot accuracy                    ${shots > 0 ? Math.round((hits / shots) * 1000) / 10 : 0}% (${hits}/${shots})`);
  console.log(`    theoretical minimum TTK         ${(Math.ceil((COMBAT.maxHealth + COMBAT.maxShield) / 34) * 0.17).toFixed(2)} s`);

  console.log('\n  ATTRIBUTION');
  const contactMedian = median(contacts);
  const ttkMedian = median(ttks);
  const lifeMedian = median(lifetimes);
  console.log(`    median life = ${lifeMedian.toFixed(1)} s = ${contactMedian.toFixed(1)} s finding a fight + ${ttkMedian.toFixed(2)} s losing it`);
  console.log(
    `    ${contactMedian < ttkMedian * 2 ? '-> dominated by SPAWN PLACEMENT: contact arrives faster than combat resolves' : '-> dominated by COMBAT PACE: players find fights slowly but lose them fast'}`,
  );

  process.exit(0);
}

main().catch((error) => {
  console.error('[spawn-audit] fatal:', error);
  process.exit(1);
});
