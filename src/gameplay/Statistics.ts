import type { TeamId } from '@/config/teams';

/**
 * Per-player match statistics, MVP scoring and XP.
 *
 * Deliberately separate from `Actor`: none of this replicates during play (it is derived, and the
 * scoreboard is only read between rounds), so keeping it out of the actor struct keeps it out of
 * every snapshot. The server owns the authoritative copy; clients receive it once at match end.
 */

export interface PlayerStats {
  actorId: number;
  name: string;
  team: TeamId;
  isBot: boolean;

  tags: number;
  timesTagged: number;
  assists: number;

  shotsFired: number;
  shotsHit: number;
  headshots: number;
  damageDealt: number;
  shieldDamageDealt: number;
  damageTaken: number;

  /** Objective actions: captures, hill seconds, node flips. */
  objectiveScore: number;
  /** Seconds alive, for a survivability read. */
  timeAlive: number;
  /** Best consecutive tags without being tagged. */
  bestStreak: number;
  currentStreak: number;

  distanceTravelled: number;
}

export const createStats = (
  actorId: number,
  name: string,
  team: TeamId,
  isBot: boolean,
): PlayerStats => ({
  actorId,
  name,
  team,
  isBot,
  tags: 0,
  timesTagged: 0,
  assists: 0,
  shotsFired: 0,
  shotsHit: 0,
  headshots: 0,
  damageDealt: 0,
  shieldDamageDealt: 0,
  damageTaken: 0,
  objectiveScore: 0,
  timeAlive: 0,
  bestStreak: 0,
  currentStreak: 0,
  distanceTravelled: 0,
});

export const accuracy = (stats: PlayerStats): number =>
  stats.shotsFired === 0 ? 0 : stats.shotsHit / stats.shotsFired;

export const tagRatio = (stats: PlayerStats): number =>
  stats.timesTagged === 0 ? stats.tags : stats.tags / stats.timesTagged;

/**
 * MVP score.
 *
 * Weighted so that a player who only farms tags does not automatically beat one who won the match
 * on objectives. Objective work is weighted highest per unit precisely because it is the thing
 * players under-value and the thing that decides matches.
 */
export function mvpScore(stats: PlayerStats): number {
  return (
    stats.tags * 100 +
    stats.assists * 40 +
    stats.objectiveScore * 150 +
    stats.damageDealt * 0.5 +
    stats.bestStreak * 25 +
    accuracy(stats) * 200 -
    stats.timesTagged * 20
  );
}

/** Fraction of the team's total contribution this player is responsible for, 0..1. */
export function teamContribution(stats: PlayerStats, teamStats: PlayerStats[]): number {
  const total = teamStats.reduce((sum, s) => sum + Math.max(0, mvpScore(s)), 0);
  if (total <= 0) return 0;
  return Math.max(0, mvpScore(stats)) / total;
}

export interface XpBreakdown {
  base: number;
  tags: number;
  assists: number;
  objectives: number;
  accuracyBonus: number;
  winBonus: number;
  mvpBonus: number;
  total: number;
}

/**
 * XP award. Participation-weighted rather than purely performance-weighted, so a losing player who
 * contributed still progresses — the alternative reliably drives people out of the modes that need
 * populations most.
 */
export function computeXp(stats: PlayerStats, won: boolean, isMvp: boolean): XpBreakdown {
  const base = 100;
  const tags = stats.tags * 25;
  const assists = stats.assists * 10;
  const objectives = stats.objectiveScore * 40;
  const accuracyBonus = Math.round(accuracy(stats) * 150);
  const winBonus = won ? 200 : 0;
  const mvpBonus = isMvp ? 250 : 0;
  return {
    base,
    tags,
    assists,
    objectives,
    accuracyBonus,
    winBonus,
    mvpBonus,
    total: base + tags + assists + objectives + accuracyBonus + winBonus + mvpBonus,
  };
}

/** Collects every player's stats and resolves the MVP. */
export class StatsTracker {
  private readonly stats = new Map<number, PlayerStats>();

  register(actorId: number, name: string, team: TeamId, isBot: boolean): PlayerStats {
    const existing = this.stats.get(actorId);
    if (existing) return existing;
    const created = createStats(actorId, name, team, isBot);
    this.stats.set(actorId, created);
    return created;
  }

  get(actorId: number): PlayerStats | undefined {
    return this.stats.get(actorId);
  }

  all(): PlayerStats[] {
    return [...this.stats.values()];
  }

  recordShot(actorId: number): void {
    const s = this.stats.get(actorId);
    if (s) s.shotsFired++;
  }

  recordHit(attackerId: number, victimId: number, damage: number, shieldPortion: number, headshot: boolean): void {
    const attacker = this.stats.get(attackerId);
    if (attacker) {
      attacker.shotsHit++;
      attacker.damageDealt += damage;
      attacker.shieldDamageDealt += shieldPortion;
      if (headshot) attacker.headshots++;
    }
    const victim = this.stats.get(victimId);
    if (victim) victim.damageTaken += damage;
  }

  recordElimination(killerId: number | null, victimId: number): void {
    if (killerId !== null && killerId !== victimId) {
      const killer = this.stats.get(killerId);
      if (killer) {
        killer.tags++;
        killer.currentStreak++;
        killer.bestStreak = Math.max(killer.bestStreak, killer.currentStreak);
      }
    }
    const victim = this.stats.get(victimId);
    if (victim) {
      victim.timesTagged++;
      victim.currentStreak = 0;
    }
  }

  recordAssist(actorId: number): void {
    const s = this.stats.get(actorId);
    if (s) s.assists++;
  }

  recordObjective(actorId: number, points: number): void {
    const s = this.stats.get(actorId);
    if (s) s.objectiveScore += points;
  }

  recordAliveTime(actorId: number, dt: number): void {
    const s = this.stats.get(actorId);
    if (s) s.timeAlive += dt;
  }

  recordDistance(actorId: number, metres: number): void {
    const s = this.stats.get(actorId);
    if (s) s.distanceTravelled += metres;
  }

  /** Highest MVP score across all players. Ties break toward the higher objective score. */
  mvp(): PlayerStats | null {
    let best: PlayerStats | null = null;
    let bestScore = -Infinity;
    for (const s of this.stats.values()) {
      const score = mvpScore(s);
      if (score > bestScore || (score === bestScore && best && s.objectiveScore > best.objectiveScore)) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  reset(): void {
    this.stats.clear();
  }
}
