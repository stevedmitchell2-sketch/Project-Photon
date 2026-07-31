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

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: {
    reactionTime: 0.62,
    aimErrorDegrees: 6.5,
    turnRate: 3.2,
    leadAccuracy: 0.25,
    strafeChance: 0.25,
    retreatThreshold: 0.3,
    memoryDuration: 1.6,
    flankChance: 0.05,
    decisionInterval: 0.32,
    engageRange: 34,
    movementFlair: 0.15,
  },
  medium: {
    reactionTime: 0.36,
    aimErrorDegrees: 3.4,
    turnRate: 5.4,
    leadAccuracy: 0.6,
    strafeChance: 0.5,
    retreatThreshold: 0.35,
    memoryDuration: 3,
    flankChance: 0.2,
    decisionInterval: 0.24,
    engageRange: 45,
    movementFlair: 0.4,
  },
  hard: {
    reactionTime: 0.2,
    aimErrorDegrees: 1.7,
    turnRate: 8.5,
    leadAccuracy: 0.85,
    strafeChance: 0.7,
    retreatThreshold: 0.4,
    memoryDuration: 5,
    flankChance: 0.4,
    decisionInterval: 0.16,
    engageRange: 58,
    movementFlair: 0.7,
  },
  expert: {
    reactionTime: 0.12,
    aimErrorDegrees: 0.8,
    turnRate: 12,
    leadAccuracy: 0.97,
    strafeChance: 0.85,
    retreatThreshold: 0.45,
    memoryDuration: 7,
    flankChance: 0.6,
    decisionInterval: 0.1,
    engageRange: 75,
    movementFlair: 1,
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
