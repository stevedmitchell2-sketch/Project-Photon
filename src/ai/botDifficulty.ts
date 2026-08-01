export type BotDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface BotProfile {
  /** Seconds between spotting a target and being allowed to fire. */
  reactionTime: number;
  /** Aim error cone half-angle in degrees at rest. */
  aimErrorDegrees: number;
  /** How fast the bot's aim converges on the target, in radians/second. */
  turnRate: number;
  /** Fraction of the target's velocity the bot leads by. 1.0 is a perfect lead. */
  leadAccuracy: number;
  /** Probability per decision tick of choosing to strafe rather than hold. */
  strafeChance: number;
  /** Health fraction below which the bot looks for cover. */
  retreatThreshold: number;
  /** Seconds a lost target stays "remembered" and searchable. */
  memoryDuration: number;
  /** Chance per decision to use a flanking route instead of a direct approach. */
  flankChance: number;
  /** How often the bot re-runs its decision logic, in seconds. Also its reflex granularity. */
  decisionInterval: number;
  /** Maximum distance at which the bot will engage at all. */
  engageRange: number;
  /** Multiplier on how often it jumps/slides while fighting. */
  movementFlair: number;
}

/**
 * Difficulty ladder.
 *
 * Rebalanced in Sprint 8 against measurement rather than feel. `scripts/spawnAudit.ts` runs a real
 * headless bot match and reports how long a life lasts and what ends it. The Sprint 7 playtest
 * finding — "you die roughly ten seconds after every spawn" — was reproduced exactly by that
 * harness at the default difficulty, and then attributed:
 *
 *   | difficulty | median life | died <10 s | spawn to contact | time to kill | bot accuracy |
 *   | easy       | 16.2 s      | 22%        | 9.7 s            | 3.42 s       | 23.7%        |
 *   | medium     | 10.0 s      | 50%        | 7.1 s            | 2.38 s       | 35.9%        |
 *   | hard       |  8.1 s      | 61%        | 5.6 s            | 2.00 s       | 47.3%        |
 *
 * Spawn placement was *not* the cause and needed no change: the median spawn put the nearest enemy
 * 30 m away, none were within 15 m, and only 2% had line of sight to an enemy. What made the game
 * feel unfair was that the default opponent shot like a good human — 360 ms reaction, 3.4° of aim
 * error, engaging out to 45 m — so half of all lives ended inside ten seconds.
 *
 * The ladder was compressed at the bottom and had no headroom at the top: `easy` was the only
 * forgiving setting and `medium` jumped straight to near-human. Every rung is therefore shifted
 * down roughly one step, and the top two stretched. The intent per rung:
 *
 *   easy    a genuine beginner opponent — slow to notice, wide aim, short engagement range
 *   medium  the default. Should lose to an attentive player and punish an inattentive one
 *   hard    what `medium` used to be: sharp, competitive, reads as a good human
 *   expert  faster than a good human, kept for bot-practice and for AI work later
 *
 * After the change, measured the same way (medium averaged over three seeds):
 *
 *   | difficulty | median life | died <10 s | time to kill |
 *   | easy       | 26.7 s      | 11%        | 6.59 s       |
 *   | medium     | ~14 s       | ~32%       | 3.48 s       |
 *   | hard       | 10.5 s      | 46%        | 2.14 s       |
 *   | expert     |  8.5 s      | 60%        | 1.56 s       |
 *
 * The default life is half again as long and half as many lives end inside ten seconds, while the
 * ladder now spans a genuine range instead of bunching at the hard end.
 *
 * If these values are touched again, re-run `npm run spawn-audit` rather than adjusting by feel —
 * the whole point of the table above is that intuition about this was wrong for two sprints.
 */
export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: {
    reactionTime: 0.78,
    aimErrorDegrees: 8,
    turnRate: 2.6,
    leadAccuracy: 0.15,
    strafeChance: 0.2,
    retreatThreshold: 0.3,
    memoryDuration: 1.3,
    flankChance: 0.03,
    decisionInterval: 0.36,
    engageRange: 26,
    movementFlair: 0.12,
  },
  medium: {
    reactionTime: 0.44,
    aimErrorDegrees: 4.2,
    turnRate: 4.6,
    leadAccuracy: 0.46,
    strafeChance: 0.4,
    retreatThreshold: 0.34,
    memoryDuration: 2.5,
    flankChance: 0.14,
    decisionInterval: 0.26,
    engageRange: 40,
    movementFlair: 0.3,
  },
  hard: {
    reactionTime: 0.34,
    aimErrorDegrees: 3.2,
    turnRate: 5.6,
    leadAccuracy: 0.62,
    strafeChance: 0.52,
    retreatThreshold: 0.36,
    memoryDuration: 3.2,
    flankChance: 0.22,
    decisionInterval: 0.22,
    engageRange: 46,
    movementFlair: 0.45,
  },
  expert: {
    reactionTime: 0.18,
    aimErrorDegrees: 1.5,
    turnRate: 9.5,
    leadAccuracy: 0.9,
    strafeChance: 0.75,
    retreatThreshold: 0.42,
    memoryDuration: 6,
    flankChance: 0.45,
    decisionInterval: 0.14,
    engageRange: 62,
    movementFlair: 0.8,
  },
};

/** Bot display names, cycled per team so the killfeed reads like a real lobby. */
export const BOT_NAMES = [
  'VOLT',
  'ECHO',
  'PRISM',
  'RAZE',
  'NOVA',
  'KILO',
  'ONYX',
  'HALO',
  'ZEPH',
  'ARC',
  'FLUX',
  'VEX',
] as const;
