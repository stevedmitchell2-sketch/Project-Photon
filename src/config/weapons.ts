export type WeaponId =
  | 'photon_rifle'
  | 'ph2_sidearm'
  | 'ph9_smg'
  | 'ph4_marksman'
  | 'ph7_heavy';

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

  /**
   * PH-2 Vector. Sidearm: fast to bring on target, punished at range.
   *
   * Its job in the roster is to be the weapon you are never sorry to hold and never happy to keep.
   * Falloff starting at 14 m is the whole design — inside a room it trades evenly with the rifle,
   * past one it cannot close a fight.
   */
  ph2_sidearm: {
    id: 'ph2_sidearm',
    displayName: 'PH-2 Vector',

    cellCapacity: 10,
    fireInterval: 0.14,
    rechargeDuration: 1.35,
    trickleDelay: 1.9,
    trickleRate: 0.8,
    ventCostPerShot: 0.1,

    projectileSpeed: 190,
    projectileLifetime: 1.2,
    projectileRadius: 0.075,
    projectileGravity: 0,

    damage: 21,
    headshotMultiplier: 1.8,
    falloffStart: 14,
    falloffEnd: 30,
    minDamageScale: 0.45,

    spreadBase: 0.55,
    spreadMoving: 1.25,
    spreadAir: 2.6,
    spreadAds: 0.16,
    spreadPerShot: 0.42,
    spreadMax: 4.0,
    spreadRecovery: 4.4,

    recoilPitch: 0.7,
    recoilYaw: 0.26,
    recoilRecoveryHalfLife: 0.09,

    adsTime: 0.12,
    adsFovScale: 0.82,
    adsSensitivityScale: 0.78,

    cameraShake: 0.24,
    rumbleStrong: 0.2,
    rumbleWeak: 0.42,
    rumbleMs: 55,
  },

  /**
   * PH-9 Swift. SMG: the highest rate of fire in the roster, and the least forgiving of holding it.
   *
   * `spreadPerShot` at 0.62 against a 5.2 max means the cone opens faster than any other weapon, so
   * sustained fire is self-limiting. It wins the first half-second of a close fight and loses the
   * second.
   */
  ph9_smg: {
    id: 'ph9_smg',
    displayName: 'PH-9 Swift',

    cellCapacity: 14,
    fireInterval: 0.085,
    rechargeDuration: 1.7,
    trickleDelay: 2.2,
    trickleRate: 0.9,
    ventCostPerShot: 0.09,

    projectileSpeed: 175,
    projectileLifetime: 1.1,
    projectileRadius: 0.07,
    projectileGravity: 0,

    damage: 15,
    headshotMultiplier: 1.5,
    falloffStart: 12,
    falloffEnd: 26,
    minDamageScale: 0.4,

    spreadBase: 0.7,
    spreadMoving: 1.1,
    spreadAir: 2.8,
    spreadAds: 0.32,
    spreadPerShot: 0.62,
    spreadMax: 5.2,
    spreadRecovery: 5.0,

    recoilPitch: 0.5,
    recoilYaw: 0.3,
    recoilRecoveryHalfLife: 0.07,

    adsTime: 0.13,
    adsFovScale: 0.85,
    adsSensitivityScale: 0.8,

    cameraShake: 0.2,
    rumbleStrong: 0.16,
    rumbleWeak: 0.38,
    rumbleMs: 45,
  },

  /**
   * PH-4 Meridian. Precision: the weapon Apex's long sight lines were asking for.
   *
   * Measurement during the Apex playtest found kills clustering at 3-10 m even on 40 m sight lines,
   * because nothing in the roster rewarded shooting across one. A 420 m/s bolt with falloff starting
   * at 60 m does. The 0.62 s fire interval is what stops it from also being the close-range answer.
   */
  ph4_marksman: {
    id: 'ph4_marksman',
    displayName: 'PH-4 Meridian',

    cellCapacity: 5,
    fireInterval: 0.62,
    rechargeDuration: 2.3,
    trickleDelay: 2.8,
    trickleRate: 0.45,
    ventCostPerShot: 0.18,

    projectileSpeed: 420,
    projectileLifetime: 2.4,
    projectileRadius: 0.06,
    projectileGravity: 0,

    damage: 62,
    headshotMultiplier: 2.1,
    falloffStart: 60,
    falloffEnd: 95,
    minDamageScale: 0.8,

    spreadBase: 0.12,
    spreadMoving: 2.6,
    spreadAir: 4.5,
    spreadAds: 0.01,
    spreadPerShot: 0.9,
    spreadMax: 4.5,
    spreadRecovery: 2.4,

    recoilPitch: 2.1,
    recoilYaw: 0.18,
    recoilRecoveryHalfLife: 0.2,

    adsTime: 0.22,
    adsFovScale: 0.5,
    adsSensitivityScale: 0.5,

    cameraShake: 0.7,
    rumbleStrong: 0.6,
    rumbleWeak: 0.35,
    rumbleMs: 120,
  },

  /**
   * PH-7 Bastion. Heavy: slow, wide bolts that punish a crowded lane.
   *
   * The large projectile radius is the point — it is the only weapon in the roster that is easier to
   * land than to aim, and the 118 m/s travel time is what pays for that. Leading a moving target at
   * 20 m is a real skill requirement rather than a rounding error.
   */
  ph7_heavy: {
    id: 'ph7_heavy',
    displayName: 'PH-7 Bastion',

    cellCapacity: 4,
    fireInterval: 0.78,
    rechargeDuration: 2.9,
    trickleDelay: 3.2,
    trickleRate: 0.35,
    ventCostPerShot: 0.22,

    projectileSpeed: 118,
    projectileLifetime: 2.0,
    projectileRadius: 0.26,
    projectileGravity: 0,

    damage: 55,
    headshotMultiplier: 1.3,
    falloffStart: 18,
    falloffEnd: 40,
    minDamageScale: 0.55,

    spreadBase: 0.9,
    spreadMoving: 2.2,
    spreadAir: 3.6,
    spreadAds: 0.4,
    spreadPerShot: 0.8,
    spreadMax: 4.8,
    spreadRecovery: 2.6,

    recoilPitch: 2.4,
    recoilYaw: 0.5,
    recoilRecoveryHalfLife: 0.24,

    adsTime: 0.26,
    adsFovScale: 0.88,
    adsSensitivityScale: 0.72,

    cameraShake: 0.85,
    rumbleStrong: 0.75,
    rumbleWeak: 0.5,
    rumbleMs: 140,
  },
};

export const DEFAULT_WEAPON: WeaponId = 'photon_rifle';
