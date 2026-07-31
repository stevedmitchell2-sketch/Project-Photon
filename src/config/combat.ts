/** Health, shield and damage-feedback tuning shared by players and bots. */
export const COMBAT = {
  maxHealth: 100,
  maxShield: 60,
  /** Shield absorbs damage first and is the only thing that regenerates in combat. */
  shieldRegenDelay: 3.2,
  shieldRegenRate: 34,
  /** Health regenerates only after a longer lull, at a slower rate. */
  healthRegenDelay: 6.0,
  healthRegenRate: 12,

  /** Vertical band above the capsule centre counted as a head hit. */
  headshotHeightFraction: 0.78,

  /** Seconds of invulnerability after respawning, cancelled early by firing. */
  spawnProtection: 1.5,

  /** How long a player is dead before the respawn button becomes available (min of mode timer). */
  minDeathTime: 1.2,

  /** Hit marker and damage-number presentation. */
  hitMarkerDuration: 0.22,
  killMarkerDuration: 0.45,
  damageIndicatorDuration: 1.4,

  /** Killfeed retention. */
  killFeedDuration: 6,
  killFeedMax: 6,
} as const;

export const RUMBLE = {
  hitTaken: { strong: 0.55, weak: 0.3, ms: 140 },
  hitDealt: { strong: 0.0, weak: 0.35, ms: 45 },
  kill: { strong: 0.5, weak: 0.6, ms: 180 },
  land: { strong: 0.2, weak: 0.15, ms: 90 },
  slideStart: { strong: 0.15, weak: 0.25, ms: 120 },
} as const;
