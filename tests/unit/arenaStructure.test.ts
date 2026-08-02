import { beforeAll, describe, expect, it } from 'vitest';
import { NavGraph } from '@/ai/NavGraph';
import { buildArena, getArena } from '@/maps/MapBuilder';
import { initPhysics, PhysicsWorld } from '@/physics/PhysicsWorld';
import type { ArenaDefinition } from '@/maps/MapTypes';

/**
 * Structural invariants for Apex.
 *
 * Every one of these failed at some point while the arena was being built, and not one of them
 * would have been caught by a typecheck, a lint or a render. The failures all looked the same from
 * the outside — geometry that built, collided and drew perfectly, and that no player or bot could
 * use:
 *
 *   - ramps running underneath the walkway they were meant to land on, so every sample on them
 *     failed the crouch-headroom probe and the whole mezzanine baked out as an island;
 *   - stairs 44 degrees steep, which a person can climb and the navigation linker cannot;
 *   - bridges railed end to end, so the stairs to them landed against a pane of glass;
 *   - a landing pad mirrored onto the opposite side of its own span;
 *   - a spectator deck's approach stair sitting on top of a bracket arm and quietly making bots
 *     walk 77 m the wrong way round the building.
 *
 * The full picture lives in `npm run arena-audit`. This is the subset worth failing a build over.
 */

let physicsReady = false;

interface Built {
  definition: ArenaDefinition;
  nav: NavGraph;
  physics: PhysicsWorld;
  batches: number;
}

const cache = new Map<string, Built>();

function build(id: string): Built {
  const existing = cache.get(id);
  if (existing) return existing;
  const definition = getArena(id);
  const physics = new PhysicsWorld();
  const built = buildArena(physics, definition);
  const nav = NavGraph.build(physics, definition);
  const result = { definition, nav, physics, batches: built.batches.length };
  cache.set(id, result);
  return result;
}

beforeAll(async () => {
  if (!physicsReady) {
    await initPhysics();
    physicsReady = true;
  }
}, 30_000);

describe('Apex structure', () => {
  it('reaches the objective from every spawn', () => {
    const { definition, nav } = build('arena02_apex');
    const hill = definition.objectives.find((o) => o.kind === 'hill')!;
    const goal = nav.nearestNode({ x: hill.p[0], y: hill.p[1], z: hill.p[2] }, 6);
    expect(goal).toBeGreaterThanOrEqual(0);

    const path: number[] = [];
    const stranded = definition.spawns.filter((spawn) => {
      const start = nav.nearestNode({ x: spawn.p[0], y: spawn.p[1], z: spawn.p[2] }, 6);
      return start < 0 || nav.findPath(start, goal, path) <= 0;
    });
    expect(stranded.map((s) => s.p.join(','))).toEqual([]);
  });

  it('bakes walkable ground on all three declared levels', () => {
    const { definition, nav } = build('arena02_apex');
    expect(definition.floorHeights).toEqual([0, 5, 9]);

    for (const height of definition.floorHeights) {
      const onLevel = nav.nodes.filter((n) => Math.abs(n.y - height) < 2.4);
      // A level with a handful of nodes is a ledge, not a floor a match is played on.
      expect(onLevel.length, `level y=${height}`).toBeGreaterThan(150);
    }
  });

  it('keeps the whole play space in one connected component', () => {
    const { nav } = build('arena02_apex');
    const seen = new Int32Array(nav.nodeCount).fill(-1);
    let largest = 0;
    let id = 0;
    for (let i = 0; i < nav.nodeCount; i++) {
      if (seen[i] >= 0) continue;
      const stack = [i];
      seen[i] = id;
      let size = 0;
      while (stack.length) {
        const v = stack.pop()!;
        size++;
        for (const w of nav.nodes[v].neighbors) {
          if (seen[w] < 0) {
            seen[w] = id;
            stack.push(w);
          }
        }
      }
      largest = Math.max(largest, size);
      id++;
    }
    // Measured at 98.2%. The remainder is the tops of cover blocks and the reactor drums, which are
    // reachable by mantling but not by walking and are correctly unlinked. The threshold matters:
    // at one point in this arena's construction the upper bridge and both Sky Decks came adrift as
    // a single 201-node island, which is 7.7% — comfortably caught here, and invisible to every
    // other check in the project.
    expect(largest / nav.nodeCount).toBeGreaterThan(0.95);
  });

  it('puts red and blue exactly the same distance from the objective', () => {
    const { definition, nav } = build('arena02_apex');
    const hill = definition.objectives.find((o) => o.kind === 'hill')!;
    const goal = nav.nearestNode({ x: hill.p[0], y: hill.p[1], z: hill.p[2] }, 6);
    const path: number[] = [];

    const meanFor = (team: string): number => {
      const lengths = definition.spawns
        .filter((s) => s.team === team)
        .map((s) => {
          const start = nav.nearestNode({ x: s.p[0], y: s.p[1], z: s.p[2] }, 6);
          const count = nav.findPath(start, goal, path);
          let total = 0;
          for (let i = 1; i < count; i++) {
            const a = nav.nodes[path[i - 1]];
            const b = nav.nodes[path[i]];
            total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
          }
          return total;
        });
      return lengths.reduce((s, v) => s + v, 0) / lengths.length;
    };

    const red = meanFor('red');
    const blue = meanFor('blue');
    // Two-fold symmetry maps red onto blue exactly, so this is not a tolerance so much as a check
    // that the symmetry was actually applied to everything that affects a route.
    expect(Math.abs(red - blue) / red).toBeLessThan(0.02);
  });

  it('keeps the navigation ceiling between the top of play and the bottom of the bowl', () => {
    const { definition, nav } = build('arena02_apex');
    // Sampling casts down from ceilingY + 1. Below the sky bridges and it misses the arena's best
    // route; above the first row of seating and bots start pathing into the crowd.
    expect(definition.ceilingY).toBeGreaterThan(9.0);
    expect(definition.ceilingY).toBeLessThan(12.0);

    // Nothing can be sampled above the cast height, and the upper bridge at 11.2 has to be below
    // it. The 12.1 ceiling is the top of the reactor's tallest drum, which is legitimately standable.
    const highest = Math.max(...nav.nodes.map((n) => n.y));
    expect(highest).toBeLessThan(definition.ceilingY + 1);
    expect(highest).toBeGreaterThan(11.0);
  });

  it('draws the shell in a bounded number of batches', () => {
    const { batches } = build('arena02_apex');
    // Batches key on (kind, colour, glow), so this is really a cap on one-off colour overrides.
    // Apex is roughly six times the geometry of Classic for under twice the draw calls.
    expect(batches).toBeLessThanOrEqual(40);
  });

  it('does not draw procedural galleries or a procedural rig over the real ones', () => {
    const { definition } = build('arena02_apex');
    expect(definition.proceduralGalleries).toBe(false);
    expect(definition.proceduralCeilingRig).toBe(false);
  });
});
