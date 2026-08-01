export type WeaponId = 'photon_rifle';

export interface WeaponConfig {
  id: WeaponId;
  displayName: string;

  /** Shots in a cell before the emitter must cycle. */
  cellCapacity: number;
  /** Minimum seconds between shots. */
  fireInterval: number;
  /** Full recharge cycle length once the cell empties. */
  rechargeDuration: number;
  /** A partially-drained cell trickles back after this idle period, at `trickleRate` shots/sec. */
  trickleDelay: number;
  trickleRate: number;
  /** Venting early (manual recharge) costs this fraction of a full cycle per remaining shot. */
  ventCostPerShot: number;

  // --- Ballistics ---
  /** Bolts are real travelling entities, not hitscan. */
  projectileSpeed: number;
  projectileLifetime: number;
  projectileRadius: number;
  /** Gravity applied to bolts. Zero keeps aim honest; kept as data for future weapons. */
  projectileGravity: number;

  // --- Damage ---
  damage: number;
  headshotMultiplier: number;
  /** Damage falloff starts here and reaches `minDamageScale` at `falloffEnd`. */
  falloffStart: number;
  falloffEnd: number;
  minDamageScale: number;

  // --- Accuracy (degrees of cone half-angle) ---
  spreadBase: number;
  spreadMoving: number;
  spreadAir: number;
  spreadAds: number;
  /** Spread added per shot, decaying at `spreadRecovery` degrees/sec. */
  spreadPerShot: number;
  spreadMax: number;
  spreadRecovery: number;

  // --- Recoil (degrees) ---
  recoilPitch: number;
  recoilYaw: number;
  recoilRecoveryHalfLife: number;

  // --- ADS ---
  adsTime: number;
  adsFovScale: number;
  adsSensitivityScale: number;

  // --- Feel ---
  cameraShake: number;
  rumbleStrong: number;
  rumbleWeak: number;
  rumbleMs: number;
}

/**
 * Weapon tuning.
 *
 * Tuned in Sprint 9 around a **7 metre** engagement, which is not a design choice so much as an
 * observed fact: `npm run spawn-audit` reports a median engagement range of 7.0 m at every
 * difficulty, and it does not move when `engageRange` is changed. Bots close to contact before
 * shooting, so that is where this game actually happens. The weapon is now tuned for the fight it
 * has rather than the fight it was designed for.
 *
 * The geometry that matters at 7 m, against a 0.36 m capsule radius:
 *
 *   spread cone      base +/- 4 cm, moving +/- 14 cm, max +/- 44 cm
 *   half a body      36 cm  <- the number every spread figure should be read against
 *   travel time      7 m / projectileSpeed
 *   lead required    8.4 m/s (sprint) x travel time
 *
 * Two things were wrong for close quarters:
 *
 * 1. **Bolts were too slow.** At 132 m/s a bolt took 53 ms to cross 7 m, so hitting a strafing
 *    player meant leading by 45 cm -- more than a full half-width, at the range where the fantasy
 *    is that a laser arrives instantly. Raised to 215 m/s: 33 ms, 27 cm of lead, comfortably inside
 *    a body. Bolts still cross the 60 m arena in a quarter second, so they remain visible streaks
 *    rather than becoming hitscan.
 *
 * 2. **The cell had no margin.** 100 health + 60 shield is five bolts, out of a six-shot cell. One
 *    miss forced a recharge in the middle of a fight, and measured accuracy is nowhere near 5/6.
 *    Capacity is now eight, so a fight can be won with three misses. Recharge duration is unchanged
 *    -- the intent is fewer interrupted fights, not faster kills.
 *
 * `spreadPerShot` drops in step with the larger cell: at the old 0.42 deg a full eight-shot burst
 * ended at +/- 40 cm, wider than a body, so the extra capacity would have been unusable. At 0.34 it
 * ends at +/- 33 cm, just inside. Sustained fire stays viable at 7 m and is still punished at range.
 *
 * **Damage pays for all of it.** Faster bolts, a bigger cell and tighter sustained spread make the
 * weapon better for everyone -- including the bots -- and measurement caught that immediately: the
 * median life fell from ~14 s to ~10.6 s, undoing the Sprint 8 difficulty rebalance. Damage drops
 * 34 -> 28 to compensate, which takes a kill from five bolts to six and restores the pace without
 * giving back any of the responsiveness. Six of an eight-shot cell still leaves two misses of
 * margin, where the original six-shot cell left one.
 */
export const WEAPONS: Record<WeaponId, WeaponConfig> = {
  photon_rifle: {
    id: 'photon_rifle',
    displayName: 'PH-6 Photon Rifle',

    cellCapacity: 8,
    fireInterval: 0.17,
    rechargeDuration: 1.85,
    trickleDelay: 2.4,
    trickleRate: 0.55,
    ventCostPerShot: 0.12,

    projectileSpeed: 215,
    projectileLifetime: 1.6,
    projectileRadius: 0.09,
    projectileGravity: 0,

    damage: 28,
    headshotMultiplier: 1.7,
    falloffStart: 28,
    falloffEnd: 55,
    minDamageScale: 0.62,

    spreadBase: 0.35,
    spreadMoving: 1.15,
    spreadAir: 2.4,
    spreadAds: 0.08,
    spreadPerShot: 0.34,
    spreadMax: 3.6,
    spreadRecovery: 3.2,

    recoilPitch: 0.85,
    recoilYaw: 0.22,
    recoilRecoveryHalfLife: 0.11,

    adsTime: 0.16,
    adsFovScale: 0.72,
    adsSensitivityScale: 0.68,

    cameraShake: 0.35,
    rumbleStrong: 0.28,
    rumbleWeak: 0.55,
    rumbleMs: 70,
  },
};

export const DEFAULT_WEAPON: WeaponId = 'photon_rifle';
