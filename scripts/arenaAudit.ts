import { NavGraph } from '../src/ai/NavGraph';
import { buildArena, getArena, ARENAS } from '../src/maps/MapBuilder';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { GROUP_WORLD_QUERY } from '../src/physics/layers';
import type { ArenaDefinition } from '../src/maps/MapTypes';

/**
 * Arena structural audit.
 *
 * Sprint 15 committed a spectator gallery that was buried inside a wall. It typechecked, it linted,
 * seventy tests passed and it built clean, because none of those things look at where geometry
 * actually is. The defect survived a whole sprint and was found by eye in the first thirty seconds
 * of looking at it.
 *
 * This is the gate that would have caught it. It builds the arena for real — the same
 * `buildArena` and the same `NavGraph.build` the game runs — and asks the questions that a
 * compiler cannot:
 *
 *   - how many draw calls does the shell cost, and how many colliders;
 *   - does navigation actually reach every level, or is a floor decorative;
 *   - can a bot path from every spawn to the objective, or is a wing sealed off;
 *   - are the team spawns equidistant from the middle, or is one team closer;
 *   - how long are the sight lines, which is the thing that decides whether the difficulty
 *     ladder can express itself at all.
 *
 *   npm run arena-audit
 *   npm run arena-audit -- --arena arena01_classic
 */

interface Args {
  arena?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arena') args.arena = argv[++i];
  }
  return args;
}

const fmt = (n: number, places = 1) => n.toFixed(places).padStart(7);

/**
 * Samples sight lines from a set of nav nodes.
 *
 * This is the measurement that explains Arena 01's collapsed difficulty ladder. Bot aim error is
 * specified in metres of miss at range, so if no engagement in the arena ever happens beyond about
 * ten metres, `hard` and `expert` have nowhere to be better than `medium` — and the audit showed
 * exactly that. An arena that wants four distinct tiers has to supply the distance.
 */
function sightLines(physics: PhysicsWorld, nodes: Array<{ x: number; y: number; z: number }>) {
  const EYE = 1.6;
  const samples: number[] = [];
  // A deterministic stride over the node list rather than a random sample, so the number is
  // reproducible between runs and between arenas.
  const stride = Math.max(1, Math.floor(nodes.length / 260));
  for (let i = 0; i < nodes.length; i += stride) {
    const a = nodes[i];
    for (let k = 0; k < 12; k++) {
      const angle = (k / 12) * Math.PI * 2;
      const dir = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
      const from = { x: a.x, y: a.y + EYE, z: a.z };
      const hit = physics.raycast(from, dir, 90, GROUP_WORLD_QUERY);
      samples.push(hit ? Math.hypot(hit.point.x - a.x, hit.point.z - a.z) : 90);
    }
  }
  samples.sort((p, q) => p - q);
  const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  return {
    count: samples.length,
    mean,
    median: at(0.5),
    p75: at(0.75),
    p90: at(0.9),
    over15: samples.filter((v) => v >= 15).length / samples.length,
    over25: samples.filter((v) => v >= 25).length / samples.length,
  };
}

async function auditArena(definition: ArenaDefinition): Promise<boolean> {
  const physics = new PhysicsWorld();
  const built = buildArena(physics, definition);

  console.log(`\n=== ${definition.name} (${definition.id}) ===`);
  console.log(definition.description);

  // --- Geometry ------------------------------------------------------------
  const byKind = new Map<string, number>();
  for (const b of definition.brushes) byKind.set(b.kind, (byKind.get(b.kind) ?? 0) + 1);
  console.log('\nGEOMETRY');
  console.log(`  brushes            ${definition.brushes.length}`);
  console.log(`  colliders          ${built.colliderHandles.length}`);
  console.log(`  render batches     ${built.batches.length}   <- arena shell draw calls`);
  console.log(`  props              ${definition.props.length}`);
  console.log(`  lights             ${definition.lights.length} (${definition.lights.filter((l) => l.optional).length} optional)`);
  console.log(
    `  by kind            ${[...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join('  ')}`,
  );

  // Batches with a single instance are pure waste — a draw call for one box. Worth naming, because
  // they creep in every time a one-off colour override is added.
  const singletons = built.batches.filter((b) => b.instances.length === 1);
  if (singletons.length) {
    console.log(`  singleton batches  ${singletons.length}  (${singletons.map((b) => b.kind).join(', ')})`);
  }

  // --- Navigation ----------------------------------------------------------
  const t0 = Date.now();
  const nav = NavGraph.build(physics, definition);
  const buildMs = Date.now() - t0;

  const levels = new Map<number, number>();
  const nodes: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < nav.nodeCount; i++) {
    const n = nav.nodes[i];
    nodes.push({ x: n.x, y: n.y, z: n.z });
    // Bucket to the nearest declared floor height.
    let best = definition.floorHeights[0];
    for (const h of definition.floorHeights) if (Math.abs(n.y - h) < Math.abs(n.y - best)) best = h;
    levels.set(best, (levels.get(best) ?? 0) + 1);
  }

  console.log('\nNAVIGATION');
  console.log(`  nodes              ${nav.nodeCount}`);
  console.log(`  build time         ${buildMs} ms`);
  for (const h of definition.floorHeights) {
    const n = levels.get(h) ?? 0;
    console.log(`  level y=${String(h).padStart(4)}       ${String(n).padStart(5)} nodes${n === 0 ? '   <- UNREACHABLE' : ''}`);
  }

  let ok = true;
  for (const h of definition.floorHeights) {
    if ((levels.get(h) ?? 0) === 0) {
      console.log(`  FAIL: declared floor y=${h} has no walkable nodes.`);
      ok = false;
    }
  }

  // --- Connectivity --------------------------------------------------------
  //
  // The check that matters most. A beautiful wing that no bot can path into is a wing that never
  // appears in a match, and nothing else in the toolchain will tell you.
  const objective = definition.objectives.find((o) => o.kind === 'hill') ?? definition.objectives[0];
  const goal = nav.nearestNode({ x: objective.p[0], y: objective.p[1], z: objective.p[2] }, 6);
  const path: number[] = [];

  console.log('\nCONNECTIVITY');
  if (goal < 0) {
    console.log('  FAIL: the objective is not on the navigation graph.');
    ok = false;
  } else {
    let unreachable = 0;
    for (const spawn of definition.spawns) {
      const start = nav.nearestNode({ x: spawn.p[0], y: spawn.p[1], z: spawn.p[2] }, 6);
      if (start < 0) {
        console.log(`  FAIL: spawn at ${spawn.p.join(', ')} is off the navigation graph.`);
        ok = false;
        unreachable++;
        continue;
      }
      if (nav.findPath(start, goal, path) <= 0) {
        console.log(`  FAIL: no path from spawn ${spawn.p.join(', ')} to the objective.`);
        ok = false;
        unreachable++;
      }
    }
    console.log(`  spawns             ${definition.spawns.length} (${unreachable} unreachable)`);
  }

  // --- Spawn fairness ------------------------------------------------------
  //
  // Under the arena's declared symmetry every team's spawn cluster must be the same path distance
  // from the middle. This measures the *path*, not the straight line, because the straight line is
  // symmetric by construction and tells you nothing about whether the route is.
  const pathLength = (from: { x: number; y: number; z: number }): number => {
    const start = nav.nearestNode(from, 6);
    if (start < 0 || goal < 0) return NaN;
    const count = nav.findPath(start, goal, path);
    if (count <= 0) return NaN;
    let total = 0;
    for (let i = 1; i < count; i++) {
      const a = nav.nodes[path[i - 1]];
      const b = nav.nodes[path[i]];
      total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    return total;
  };

  const teams = new Map<string, number[]>();
  for (const spawn of definition.spawns) {
    if (!spawn.team) continue;
    const d = pathLength({ x: spawn.p[0], y: spawn.p[1], z: spawn.p[2] });
    if (!Number.isNaN(d)) {
      if (!teams.has(spawn.team)) teams.set(spawn.team, []);
      teams.get(spawn.team)!.push(d);
    }
  }
  console.log('\nSPAWN FAIRNESS (path distance to the objective)');
  const means = new Map<string, number>();
  for (const [team, ds] of teams) {
    const mean = ds.reduce((s, v) => s + v, 0) / ds.length;
    means.set(team, mean);
    console.log(`  ${team.padEnd(8)}           mean ${fmt(mean)} m   min ${fmt(Math.min(...ds))} m   max ${fmt(Math.max(...ds))} m`);
  }

  // The gate is on **mirror pairs**, because that is what an arena's symmetry actually promises.
  //
  // A two-fold symmetric arena guarantees red maps onto blue and green onto yellow. It does not, and
  // cannot, guarantee that red matches green — the entire point of two-fold symmetry is that the two
  // diagonals are allowed to be different buildings. Requiring all four teams to agree would be
  // requiring four-fold symmetry, which is the repetition Apex exists to escape.
  //
  // So mirror pairs must agree tightly, and the cross-diagonal spread is measured and flagged but
  // does not fail. It is a real cost of the design, and it belongs stated in the open rather than
  // hidden behind a tolerance widened until it passes.
  for (const [a, b] of [
    ['red', 'blue'],
    ['green', 'yellow'],
  ] as Array<[string, string]>) {
    const ma = means.get(a);
    const mb = means.get(b);
    if (ma === undefined || mb === undefined) continue;
    const rel = Math.abs(ma - mb) / ((ma + mb) / 2);
    console.log(`  ${a}/${b} pair`.padEnd(21) + ` differ by ${fmt(Math.abs(ma - mb))} m  (${(rel * 100).toFixed(1)}%)`);
    // 6%, not 0%, and the slack is measurement rather than design. A* breaks ties by node index,
    // and node indices are assigned in grid-scan order, which is not itself symmetric — so two
    // geometrically identical routes can return paths that differ by a couple of grid cells. Apex's
    // red/blue pair measures at exactly 0.0%, which is what a clean mirror looks like; green/yellow
    // lands at 4.6% because one spawn in each cluster has two near-equal routes and the tie falls
    // the other way. Six per cent of a 40 m path is under two grid cells.
    if (rel > 0.06) {
      console.log(`  FAIL: ${a} and ${b} are mirror images and must be equidistant from the objective.`);
      ok = false;
    }
  }
  if (means.size >= 3) {
    const all = [...means.values()];
    const spread = Math.max(...all) - Math.min(...all);
    const rel = spread / (all.reduce((s, v) => s + v, 0) / all.length);
    const note = rel > 0.1 ? '   <- 3+ team modes are measurably uneven here' : '';
    console.log(`  cross-diagonal        spread ${fmt(spread)} m  (${(rel * 100).toFixed(1)}%)${note}`);
  }

  // --- Sight lines ---------------------------------------------------------
  const sl = sightLines(physics, nodes);
  console.log('\nSIGHT LINES (horizontal, from eye height, 12 bearings per sample)');
  console.log(`  samples            ${sl.count}`);
  console.log(`  mean               ${fmt(sl.mean)} m`);
  console.log(`  median             ${fmt(sl.median)} m`);
  console.log(`  75th percentile    ${fmt(sl.p75)} m`);
  console.log(`  90th percentile    ${fmt(sl.p90)} m`);
  console.log(`  >= 15 m            ${(sl.over15 * 100).toFixed(1)}%`);
  console.log(`  >= 25 m            ${(sl.over25 * 100).toFixed(1)}%`);

  console.log(`\n  ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await initPhysics();

  const targets = args.arena ? [getArena(args.arena)] : Object.values(ARENAS);
  let allOk = true;
  for (const arena of targets) {
    allOk = (await auditArena(arena)) && allOk;
  }

  console.log('');
  if (!allOk) process.exitCode = 1;
}

void main();
