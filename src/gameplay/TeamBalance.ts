import type { TeamId } from '@/config/teams';

/**
 * Team assignment and auto-balancing.
 *
 * Balance is evaluated on *headcount first, skill second*. Skill-weighted balancing that ignores
 * headcount produces 5v3 matches that feel unwinnable regardless of how the skill maths works out,
 * and players read a numbers disadvantage as unfair far more readily than a rating one.
 *
 * Nobody is ever moved mid-match without a slot opening: switching a player who is mid-fight to the
 * other team is worse than a one-player imbalance. Rebalancing happens on join, on leave, and at
 * round boundaries.
 */

export interface BalanceMember {
  id: number;
  team: TeamId | null;
  /** Rolling skill estimate; a flat default is fine until ranked data exists. */
  rating: number;
  /** Locked players are never auto-moved — party members, or someone who just switched. */
  locked: boolean;
  connectedAtTick: number;
}

export interface BalanceResult {
  assignments: Map<number, TeamId>;
  moved: number[];
}

export interface BalanceConfig {
  teams: TeamId[];
  maxPerTeam: number;
  /** Headcount difference tolerated before a move is forced. */
  headcountTolerance: number;
  /** Rating difference (as a fraction of mean) tolerated once headcounts are level. */
  ratingTolerance: number;
}

export const defaultBalanceConfig = (teams: TeamId[], maxPerTeam: number): BalanceConfig => ({
  teams,
  maxPerTeam,
  headcountTolerance: 1,
  ratingTolerance: 0.25,
});

/** Team a joining player should be placed on: emptiest, then weakest. */
export function pickTeamForJoin(
  members: BalanceMember[],
  config: BalanceConfig,
  preferred: TeamId | null,
): TeamId | null {
  const counts = countByTeam(members, config.teams);
  const ratings = ratingByTeam(members, config.teams);

  // Honour the preference when it does not create an imbalance.
  if (preferred && counts[preferred]! < config.maxPerTeam) {
    const smallest = Math.min(...config.teams.map((t) => counts[t]!));
    if (counts[preferred]! - smallest < config.headcountTolerance) return preferred;
  }

  const available = config.teams.filter((t) => counts[t]! < config.maxPerTeam);
  if (available.length === 0) return null;

  available.sort((a, b) => {
    if (counts[a] !== counts[b]) return counts[a]! - counts[b]!;
    return ratings[a]! - ratings[b]!;
  });
  return available[0];
}

/**
 * Recomputes assignments, moving the fewest players possible.
 *
 * When a move is needed, the player chosen is the **most recently connected** unlocked member of
 * the oversized team. They have the least invested in the current round, so the move costs them
 * the least — and it is far easier to explain than moving whoever happens to have the lowest score.
 */
export function rebalance(members: BalanceMember[], config: BalanceConfig): BalanceResult {
  const assignments = new Map<number, TeamId>();
  const moved: number[] = [];

  for (const member of members) {
    if (member.team) assignments.set(member.id, member.team);
  }

  const unassigned = members.filter((m) => !m.team);
  for (const member of unassigned) {
    const team = pickTeamForJoin(
      members.filter((m) => assignments.has(m.id)),
      config,
      null,
    );
    if (team) {
      assignments.set(member.id, team);
      moved.push(member.id);
    }
  }

  // Level headcounts.
  for (let guard = 0; guard < members.length; guard++) {
    const counts = countByTeam(withAssignments(members, assignments), config.teams);
    const sorted = [...config.teams].sort((a, b) => counts[b]! - counts[a]!);
    const largest = sorted[0];
    const smallest = sorted[sorted.length - 1];
    if (counts[largest]! - counts[smallest]! <= config.headcountTolerance) break;

    const candidates = members
      .filter((m) => assignments.get(m.id) === largest && !m.locked)
      .sort((a, b) => b.connectedAtTick - a.connectedAtTick);
    const victim = candidates[0];
    if (!victim) break;

    assignments.set(victim.id, smallest);
    moved.push(victim.id);
  }

  return { assignments, moved };
}

/** True when the current split is acceptable on both headcount and rating. */
export function isBalanced(members: BalanceMember[], config: BalanceConfig): boolean {
  const counts = countByTeam(members, config.teams);
  const ratings = ratingByTeam(members, config.teams);
  const countValues = config.teams.map((t) => counts[t]!);
  if (Math.max(...countValues) - Math.min(...countValues) > config.headcountTolerance) return false;

  const ratingValues = config.teams.map((t) => ratings[t]!);
  const mean = ratingValues.reduce((a, b) => a + b, 0) / Math.max(1, ratingValues.length);
  if (mean <= 0) return true;
  return (Math.max(...ratingValues) - Math.min(...ratingValues)) / mean <= config.ratingTolerance;
}

function withAssignments(members: BalanceMember[], assignments: Map<number, TeamId>): BalanceMember[] {
  return members.map((m) => ({ ...m, team: assignments.get(m.id) ?? m.team }));
}

function countByTeam(members: BalanceMember[], teams: TeamId[]): Partial<Record<TeamId, number>> {
  const counts: Partial<Record<TeamId, number>> = {};
  for (const team of teams) counts[team] = 0;
  for (const member of members) {
    if (member.team && counts[member.team] !== undefined) counts[member.team]!++;
  }
  return counts;
}

function ratingByTeam(members: BalanceMember[], teams: TeamId[]): Partial<Record<TeamId, number>> {
  const totals: Partial<Record<TeamId, number>> = {};
  for (const team of teams) totals[team] = 0;
  for (const member of members) {
    if (member.team && totals[member.team] !== undefined) totals[member.team]! += member.rating;
  }
  return totals;
}
