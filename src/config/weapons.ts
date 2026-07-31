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

export const WEAPONS: Record<WeaponId, WeaponConfig> = {
  photon_rifle: {
    id: 'photon_rifle',
    displayName: 'PH-6 Photon Rifle',

    cellCapacity: 6,
    fireInterval: 0.17,
    rechargeDuration: 1.85,
    trickleDelay: 2.4,
    trickleRate: 0.55,
    ventCostPerShot: 0.12,

    projectileSpeed: 132,
    projectileLifetime: 1.6,
    projectileRadius: 0.09,
    projectileGravity: 0,

    damage: 34,
    headshotMultiplier: 1.7,
    falloffStart: 28,
    falloffEnd: 55,
    minDamageScale: 0.62,

    spreadBase: 0.35,
    spreadMoving: 1.15,
    spreadAir: 2.4,
    spreadAds: 0.08,
    spreadPerShot: 0.42,
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
