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
  /**
   * The distance the bot tries to *hold* once it is already fighting.
   *
   * Distinct from `engageRange`, which only decides whether a target is worth considering. This is
   * the one that decides where fights actually happen, and its absence was why every engagement in
   * the game happened at 7.0 m regardless of difficulty: the standoff band was a pair of hardcoded
   * constants in `combatMovement`, so `engageRange` could be set anywhere from 26 m to 62 m and the
   * bot would still walk to 7 m and stop.
   */
  preferredRange: number;
  /**
   * Half-width of the band around `preferredRange` the bot is content to sit in.
   *
   * Inside it the bot circles; outside it closes or backs off. A narrow band produces bots that
   * visibly yo-yo, a wide one produces bots that drift — measured, 30-35% of the preferred range
   * reads as purposeful without oscillating.
   */
  rangeTolerance: number;
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
 *
 * ## Standoff (Sprint 10)
 *
 * `preferredRange` and `rangeTolerance` were added to fix the oldest unexplained gameplay behaviour
 * in the project: every fight, at every difficulty, happened at 7.0 m. The cause was that the
 * standoff band lived as two literals inside `combatMovement` rather than in the profile, so no
 * difficulty setting could move it. The ladder now also separates *where* bots fight, not only how
 * well: an easy bot brawls at 8 m, an expert holds 25 m and makes the arena's sight lines matter.
 *
 * **`aimErrorDegrees` had to move with it, and this is the non-obvious part.** Aim error is an
 * angle, so the miss radius it produces grows with distance. The old values were monotonic *in
 * degrees* and, because every bot fought at 7 m, monotonic in metres too — which is the only reason
 * the ladder worked. Spread across the new preferred ranges they all landed at roughly three times
 * a body half-width, and the ladder inverted: `hard` bots stood at 19 m with a 1.06 m cone and
 * became measurably *safer* to fight than `medium`.
 *
 * The degrees below are therefore derived rather than chosen, from a target miss radius at each
 * bot's own preferred range, as a multiple of the 0.36 m capsule half-width:
 *
 *   easy   4.0x at 6.0 m -> 13.2 deg    hard   1.5x at 11.0 m -> 2.30 deg
 *   medium 2.7x at 8.5 m ->  5.9 deg    expert 0.9x at 13.5 m -> 1.05 deg
 *
 * The multiples are a third larger than the first derivation, because that pass restored the
 * *ordering* and lost the *pace*: medium landed at 8.9 s median life against the ~12 s the Sprint 8
 * rebalance had established as the target. Ratios preserved, magnitudes relaxed.
 *
 * `hard` and `expert` are tighter than the multiple-of-half-width rule alone would give, because
 * fighting further away is itself a handicap: a first pass at 1.3x/0.8x left `hard` measurably no
 * more lethal than `medium` across three seeds (10.8 s vs 10.1 s median life, inside the seed
 * spread) even though it was landing 47% of shots against 39%. Range has to be paid for.
 *
 * **`leadAccuracy` is the lever that actually pays for it, not `aimErrorDegrees`.** Tightening the
 * cone twice barely moved the ladder, because at these distances the dominant error is not where
 * the bot points but how far ahead of a moving target it points. At 10 m a 215 m/s bolt takes 46 ms
 * and needs a 39 cm lead; a bot leading at 0.62 of true is 15 cm short, which is half a body and
 * larger than its entire aim cone. Long-range difficulty is bought with prediction.
 *
 * If `preferredRange` changes, `aimErrorDegrees` must be recomputed the same way or the ladder will
 * silently invert again.
 *
 * **The preferred ranges are capped by the building, not by taste**, and this took five measured
 * iterations to accept. A first pass set them at 8/14/19/25 m and measured achieved ranges of
 * 5.1/9.5/11.2/12.3 m. Beyond roughly 10 m Arena 01 does not offer sight lines, so `hard` and
 * `expert` converged on the same achieved range (9.9 m and 9.8 m) despite preferring 15 m and 19 m,
 * and both spent so much of each fight repositioning rather than shooting that neither was more
 * lethal than `medium` — across seeds, `hard` was consistently the *safest* difficulty to play
 * against.
 *
 * The values below deliberately span a narrower band, 6 to 13.5 m, which is what this arena can
 * actually deliver. **A range-based difficulty ladder needs an arena with long sight lines**; that
 * is a map-design requirement, not a tuning one, and it belongs to Arenas 02-04.
 */
export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: {
    reactionTime: 0.78,
    aimErrorDegrees: 13.2,
    turnRate: 2.6,
    leadAccuracy: 0.15,
    strafeChance: 0.2,
    retreatThreshold: 0.3,
    memoryDuration: 1.3,
    flankChance: 0.03,
    decisionInterval: 0.36,
    engageRange: 26,
    preferredRange: 6,
    rangeTolerance: 2.5,
    movementFlair: 0.12,
  },
  medium: {
    reactionTime: 0.44,
    aimErrorDegrees: 5.9,
    turnRate: 4.6,
    leadAccuracy: 0.46,
    strafeChance: 0.4,
    retreatThreshold: 0.34,
    memoryDuration: 2.5,
    flankChance: 0.14,
    decisionInterval: 0.26,
    engageRange: 40,
    preferredRange: 8.5,
    rangeTolerance: 3,
    movementFlair: 0.3,
  },
  hard: {
    reactionTime: 0.34,
    aimErrorDegrees: 2.3,
    turnRate: 5.6,
    leadAccuracy: 0.88,
    strafeChance: 0.52,
    retreatThreshold: 0.36,
    memoryDuration: 3.2,
    flankChance: 0.22,
    decisionInterval: 0.22,
    engageRange: 46,
    preferredRange: 11,
    rangeTolerance: 3.5,
    movementFlair: 0.45,
  },
  expert: {
    reactionTime: 0.18,
    aimErrorDegrees: 1.05,
    turnRate: 9.5,
    leadAccuracy: 0.98,
    strafeChance: 0.75,
    retreatThreshold: 0.42,
    memoryDuration: 6,
    flankChance: 0.45,
    decisionInterval: 0.14,
    engageRange: 62,
    preferredRange: 13.5,
    rangeTolerance: 4,
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
