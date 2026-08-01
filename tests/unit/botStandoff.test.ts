import { describe, expect, it } from 'vitest';
import { standoffApproach } from '@/ai/BotBrain';
import { BOT_PROFILES, type BotDifficulty } from '@/ai/botDifficulty';
import { MOVEMENT } from '@/config/movement';

/**
 * Regression protection for the Sprint 10 bot standoff fix.
 *
 * The bug: the distance a bot tried to hold while fighting lived as two literals inside
 * `combatMovement` — close above 22 m, retreat below 7 m — rather than in the difficulty profile.
 * The equilibrium of those two constants is exactly 7 m, which is why *every* engagement in the
 * game happened at 7.0 m at *every* difficulty, and why `engageRange` (which only gates target
 * acquisition) appeared to do nothing when moved between 26 m and 62 m.
 *
 * The second, subtler half: aim error is an *angle*, so the miss radius it produces grows with
 * distance. The original values were monotonic in degrees and — because every bot fought at the
 * same 7 m — monotonic in metres too. The moment preferred ranges differed, they stopped being
 * monotonic in metres and the ladder inverted: `hard` bots stood further away with a 1.06 m cone
 * and became measurably *safer* to fight than `medium`.
 *
 * Both properties are asserted here because both are invisible in review and neither shows up in
 * a typecheck.
 */

const ORDER: BotDifficulty[] = ['easy', 'medium', 'hard', 'expert'];

/** Miss radius in metres that a profile's aim cone produces at the range it chooses to fight at. */
const aimRadiusAtOwnRange = (difficulty: BotDifficulty): number => {
  const profile = BOT_PROFILES[difficulty];
  return profile.preferredRange * Math.tan((profile.aimErrorDegrees * Math.PI) / 180);
};

describe('bot standoff', () => {
  it('closes when beyond the band, retreats when inside it, drifts when comfortable', () => {
    // Preferred 10 m, tolerance 3 m — the band is 7 m to 13 m.
    expect(standoffApproach(20, 10, 3)).toBeGreaterThan(0);
    expect(standoffApproach(4, 10, 3)).toBeLessThan(0);

    const inBand = standoffApproach(10, 10, 3);
    expect(inBand).toBeGreaterThan(0);
    expect(inBand).toBeLessThan(0.5);
  });

  it('moves its equilibrium with the preferred range', () => {
    // The whole bug in one assertion: at the *same* distance, two profiles must disagree about
    // what to do. A long-range bot at 15 m is too close and backs off; a close-range bot at 15 m
    // is too far and closes.
    //
    // Under the old hardcoded band — close above 22 m, retreat below 7 m — 15 m fell in the middle
    // for both, so both returned 0.15 and no profile could move where fights happened.
    expect(standoffApproach(15, 20, 4)).toBeLessThan(0);
    expect(standoffApproach(15, 6, 3)).toBeGreaterThan(0.5);
  });

  it('gives every difficulty a preferred range and tolerance', () => {
    for (const difficulty of ORDER) {
      const profile = BOT_PROFILES[difficulty];
      expect(profile.preferredRange).toBeGreaterThan(0);
      expect(profile.rangeTolerance).toBeGreaterThan(0);
      // A tolerance wider than the range would let the band include zero, so the bot would never
      // back off no matter how close it got.
      expect(profile.rangeTolerance).toBeLessThan(profile.preferredRange);
    }
  });

  it('orders preferred range by difficulty', () => {
    for (let i = 1; i < ORDER.length; i++) {
      expect(BOT_PROFILES[ORDER[i]].preferredRange).toBeGreaterThan(
        BOT_PROFILES[ORDER[i - 1]].preferredRange,
      );
    }
  });

  it('keeps aim error monotonic in metres, not just in degrees', () => {
    // The assertion that would have caught the inverted ladder. Degrees alone are not comparable
    // between profiles that fight at different distances.
    for (let i = 1; i < ORDER.length; i++) {
      expect(aimRadiusAtOwnRange(ORDER[i])).toBeLessThan(aimRadiusAtOwnRange(ORDER[i - 1]));
    }
  });

  it('keeps the hardest bots able to actually hit a body at their own range', () => {
    // An expert standing at its preferred range with a cone wider than a player is not an expert.
    const halfWidth = MOVEMENT.radius;
    expect(aimRadiusAtOwnRange('expert')).toBeLessThan(halfWidth * 1.5);
    expect(aimRadiusAtOwnRange('hard')).toBeLessThan(halfWidth * 2.5);
  });

  it('keeps preferred ranges inside what Arena 01 can deliver', () => {
    // Measured: beyond roughly 10 m this arena stops offering sight lines, and bots preferring
    // 15-25 m converged on the same achieved range while spending the fight repositioning. A
    // longer-sight-line arena may raise this, but it must be a deliberate change.
    for (const difficulty of ORDER) {
      expect(BOT_PROFILES[difficulty].preferredRange).toBeLessThanOrEqual(14);
    }
  });
});
