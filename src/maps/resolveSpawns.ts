import type { NavGraph } from '@/ai/NavGraph';
import { MOVEMENT } from '@/config/movement';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { isDev } from '@/util/env';
import { distSq3 } from '@/util/math';
import type { ArenaDefinition, SpawnPoint } from './MapTypes';

/**
 * Validates authored spawn points against the built collision world.
 *
 * Spawns are hand-placed coordinates, and geometry moves underneath them every time an arena is
 * edited — a barrier nudged two metres silently buries a spawn, and the player wakes up embedded
 * in it with the character controller fighting to push them out. Rather than trusting the data,
 * every spawn is capsule-tested and, if blocked, relocated to the nearest clear navigation node.
 *
 * A relocated spawn is a level bug, so it is reported loudly in development.
 */
export interface SpawnResolution {
  spawns: SpawnPoint[];
  relocated: number;
  dropped: number;
}

/** How far a blocked spawn may be moved before we give up and drop it. */
const MAX_RELOCATION_DISTANCE = 9;

export function resolveSpawns(
  arena: ArenaDefinition,
  physics: PhysicsWorld,
  nav: NavGraph,
): SpawnResolution {
  const spawns: SpawnPoint[] = [];
  let relocated = 0;
  let dropped = 0;

  for (const spawn of arena.spawns) {
    const position = { x: spawn.p[0], y: spawn.p[1], z: spawn.p[2] };

    if (physics.isCapsuleClear(position, MOVEMENT.standHeight, MOVEMENT.radius)) {
      spawns.push(spawn);
      continue;
    }

    const replacement = findClearNode(position, physics, nav);
    if (!replacement) {
      dropped++;
      if (isDev()) {
        console.error(
          `[photon] Spawn at ${format(position)} in "${arena.id}" is blocked and has no clear ` +
            'navigation node nearby. Dropping it — fix the arena data.',
        );
      }
      continue;
    }

    relocated++;
    if (isDev()) {
      console.warn(
        `[photon] Spawn at ${format(position)} in "${arena.id}" is inside geometry. ` +
          `Relocated to ${format(replacement)}.`,
      );
    }
    spawns.push({ ...spawn, p: [replacement.x, replacement.y, replacement.z] });
  }

  // Validation must never be able to brick a match. If it rejected everything, the check itself is
  // wrong, not the arena — fall back to the authored data and say so.
  if (spawns.length === 0) {
    console.error(
      `[photon] Spawn validation rejected all ${arena.spawns.length} spawns in "${arena.id}". ` +
        'Falling back to the authored list; the validator is at fault, not the map.',
    );
    return { spawns: [...arena.spawns], relocated: 0, dropped: 0 };
  }

  return { spawns, relocated, dropped };
}

function findClearNode(
  position: { x: number; y: number; z: number },
  physics: PhysicsWorld,
  nav: NavGraph,
): { x: number; y: number; z: number } | null {
  let best: { x: number; y: number; z: number } | null = null;
  let bestDistance = MAX_RELOCATION_DISTANCE * MAX_RELOCATION_DISTANCE;

  for (const node of nav.nodes) {
    const candidate = { x: node.x, y: node.y + 0.05, z: node.z };
    // Weight height heavily: relocating onto the crate you were buried in, or onto the catwalk
    // above, is technically valid and tactically wrong. Stay on the floor you were authored for.
    const dy = candidate.y - position.y;
    const d = distSq3(position, candidate) + dy * dy * 12;
    if (d >= bestDistance) continue;
    // Prefer open ground: a spawn wedged into a corner is technically clear but plays badly.
    if (node.openness < MOVEMENT.radius * 3) continue;
    if (!physics.isCapsuleClear(candidate, MOVEMENT.standHeight, MOVEMENT.radius)) continue;
    bestDistance = d;
    best = candidate;
  }
  return best;
}

const format = (p: { x: number; y: number; z: number }): string =>
  `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
