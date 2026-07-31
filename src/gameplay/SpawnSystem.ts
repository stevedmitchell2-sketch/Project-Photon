import type { TeamId } from '@/config/teams';
import type { ArenaDefinition, SpawnPoint } from '@/maps/MapTypes';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { DEG2RAD, distSq3 } from '@/util/math';
import type { Rng } from '@/util/rng';
import type { Actor, MatchState } from './types';

/**
 * Spawn selection.
 *
 * Naive "random team spawn" produces spawn camping and spawn-trading. This scores every candidate
 * against live threat: enemies nearby, enemies with line of sight, and recent use. The highest
 * scoring spawn wins, with a small random tiebreak so repeated deaths do not loop the same point.
 */

export interface SpawnChoice {
  position: { x: number; y: number; z: number };
  yaw: number;
}

const RECENT_USE_WINDOW = 6; // seconds

export class SpawnSystem {
  /** spawn index -> match time it was last used. */
  private readonly lastUsed = new Map<number, number>();
  /** Validated spawn list — never the raw arena data, which may contain buried points. */
  private readonly points: SpawnPoint[];

  constructor(
    arena: ArenaDefinition,
    private readonly rng: Rng,
    validatedSpawns?: SpawnPoint[],
  ) {
    this.points = validatedSpawns ?? arena.spawns;
  }

  choose(state: MatchState, actor: Actor, physics: PhysicsWorld, freeForAll: boolean): SpawnChoice {
    const candidates = this.candidatesFor(actor.team, freeForAll);
    let best: SpawnPoint | null = null;
    let bestScore = -Infinity;
    let bestIndex = -1;

    for (let i = 0; i < candidates.length; i++) {
      const spawn = candidates[i];
      const score = this.scoreSpawn(state, actor, spawn, physics, freeForAll);
      const jittered = score + this.rng.range(0, 4);
      if (jittered > bestScore) {
        bestScore = jittered;
        best = spawn;
        bestIndex = this.points.indexOf(spawn);
      }
    }

    if (!best) {
      // Should be unreachable for a valid arena, but never leave a player without a position.
      best = this.points[0];
      bestIndex = 0;
    }
    this.lastUsed.set(bestIndex, state.time);

    return {
      position: { x: best.p[0], y: best.p[1], z: best.p[2] },
      yaw: best.yaw * DEG2RAD,
    };
  }

  private candidatesFor(team: TeamId, freeForAll: boolean): SpawnPoint[] {
    if (freeForAll) {
      const neutral = this.points.filter((s) => s.neutral);
      return neutral.length > 0 ? neutral : this.points;
    }
    const owned = this.points.filter((s) => s.team === team);
    // Team spawns first; neutral points are the pressure valve when the base is contested.
    return owned.length > 0 ? [...owned, ...this.points.filter((s) => s.neutral)] : this.points;
  }

  private scoreSpawn(
    state: MatchState,
    actor: Actor,
    spawn: SpawnPoint,
    physics: PhysicsWorld,
    freeForAll: boolean,
  ): number {
    const position = { x: spawn.p[0], y: spawn.p[1], z: spawn.p[2] };
    const eye = { x: position.x, y: position.y + 1.6, z: position.z };
    let score = 100;

    for (const other of state.actors.values()) {
      if (other.id === actor.id || !other.alive) continue;
      const hostile = freeForAll || other.team !== actor.team;
      const d2 = distSq3(position, other.position);

      if (hostile) {
        // Heavy penalty inside a duel's worth of distance, tapering to nothing by 30 m.
        if (d2 < 900) score -= (900 - d2) / 900 * 70;
        if (d2 < 2500) {
          const otherEye = { x: other.position.x, y: other.position.y + other.height * 0.9, z: other.position.z };
          if (physics.hasLineOfSight(eye, otherEye)) score -= 90;
        }
      } else if (d2 < 400) {
        // Mild bonus for spawning near a teammate — regrouping beats trickling in alone.
        score += 12 * (1 - d2 / 400);
      }
    }

    const used = this.lastUsed.get(this.points.indexOf(spawn));
    if (used !== undefined && state.time - used < RECENT_USE_WINDOW) {
      score -= 25 * (1 - (state.time - used) / RECENT_USE_WINDOW);
    }

    return score;
  }

  reset(): void {
    this.lastUsed.clear();
  }
}
