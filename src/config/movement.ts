/**
 * Movement tuning. Every number here is metres, seconds, or metres/second — no magic units.
 *
 * The feel target is modern Call of Duty: high ground acceleration so direction changes are crisp,
 * limited air control, a slide that preserves sprint momentum and decays on a curve, and a mantle
 * that is generous enough to never feel like the geometry is fighting you.
 */
export interface MovementConfig {
  // --- Speeds (m/s) ---
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  slideStartSpeedBonus: number;
  airSpeedCap: number;

  // --- Acceleration ---
  groundAccel: number;
  groundFriction: number;
  airAccel: number;
  /** Strafe accel available while sliding — small, so slides commit. */
  slideSteerAccel: number;
  slideFriction: number;

  // --- Vertical ---
  gravity: number;
  jumpVelocity: number;
  /** Extra downward force while falling — makes jumps feel snappy rather than floaty. */
  fallGravityMultiplier: number;
  /** Jump still fires this long after leaving a ledge. */
  coyoteTime: number;
  /** A jump pressed this long before landing still fires on touchdown. */
  jumpBufferTime: number;
  terminalVelocity: number;

  // --- Stances (capsule geometry, metres) ---
  standHeight: number;
  crouchHeight: number;
  slideHeight: number;
  radius: number;
  stanceLerpHalfLife: number;
  eyeOffsetFromTop: number;

  // --- Slide ---
  slideMinEntrySpeed: number;
  slideMaxDuration: number;
  slideCooldown: number;

  // --- Mantle ---
  mantleMaxHeight: number;
  mantleMinHeight: number;
  /** How far in front of the chest we probe for a ledge. */
  mantleReach: number;
  mantleDuration: number;

  // --- Lean ---
  leanAngle: number;
  leanOffset: number;
  leanLerpHalfLife: number;

  // --- Steps & slopes ---
  stepHeight: number;
  maxSlopeAngle: number;
  snapToGroundDistance: number;

  // --- Presentation feedback (read by the camera, not the sim) ---
  viewBobAmount: number;
  viewBobFrequency: number;
  landingDipPerMps: number;
  maxLandingDip: number;
}

export const MOVEMENT: MovementConfig = {
  walkSpeed: 5.2,
  sprintSpeed: 8.4,
  crouchSpeed: 2.6,
  slideStartSpeedBonus: 3.2,
  airSpeedCap: 9.5,

  groundAccel: 95,
  groundFriction: 11,
  airAccel: 26,
  slideSteerAccel: 9,
  slideFriction: 2.6,

  gravity: 22,
  jumpVelocity: 7.1,
  fallGravityMultiplier: 1.35,
  coyoteTime: 0.11,
  jumpBufferTime: 0.13,
  terminalVelocity: 45,

  standHeight: 1.8,
  crouchHeight: 1.15,
  slideHeight: 0.95,
  radius: 0.36,
  stanceLerpHalfLife: 0.05,
  eyeOffsetFromTop: 0.16,

  slideMinEntrySpeed: 6.0,
  slideMaxDuration: 1.05,
  slideCooldown: 0.35,

  mantleMaxHeight: 1.65,
  mantleMinHeight: 0.55,
  mantleReach: 0.85,
  mantleDuration: 0.42,

  leanAngle: 14,
  leanOffset: 0.42,
  leanLerpHalfLife: 0.07,

  stepHeight: 0.42,
  maxSlopeAngle: 52,
  snapToGroundDistance: 0.35,

  viewBobAmount: 0.028,
  viewBobFrequency: 1.85,
  landingDipPerMps: 0.011,
  maxLandingDip: 0.16,
};
