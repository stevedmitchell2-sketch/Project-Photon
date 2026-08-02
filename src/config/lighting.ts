/**
 * Scene-level lighting constants.
 *
 * Single source of truth shared by the live renderer (`render/Scene.tsx`) and the offscreen
 * validator (`dev/lightingProbe.ts`). These were briefly duplicated, and the two copies drifted
 * immediately: the probe kept reporting the old exposure after the scene had been rebalanced, so a
 * change that should have darkened an unlit room measured as having no effect at all. A validator
 * that does not measure what the game actually renders is worse than no validator.
 */
export const LIGHTING = {
  /**
   * Global fill.
   *
   * Halved in Sprint 14, and this is the single change that gave the arena mood. Ambient cannot be
   * masked per-room, so it is a *floor* under every surface simultaneously — at 0.42 the perimeter
   * was lit to within a hair of the objective and nothing in the frame drew the eye. The arena was
   * disobeying its own style guide, which has said since M1 that contrast comes from lit-versus-unlit
   * regions rather than from a global dim.
   *
   * Dropping the floor is what lets the fixtures matter. The Photon Core and the ceiling rig now
   * carry the middle of the room, and the corners fall away, which is what a broadcast venue looks
   * like: a bright competition surface under a dark roof.
   *
   * The lower bound is `LUMINANCE_TARGETS.blackFloor` — below it a room stops being atmospheric and
   * becomes a bug. `npm run dev` plus the lighting probe verifies this; do not lower it further
   * without re-running that.
   */
  ambientIntensity: 0.2,
  hemisphereIntensity: 0.14,

  /** Image-based lighting. Required for metallic surfaces to render as anything but black. */
  environmentIntensity: 0.6,
  environmentIntensityPerformance: 0.45,

  /** ACES rolls midtones down hard; above 1 keeps mid-dark surfaces off the floor of the curve. */
  toneMappingExposure: 1.35,

  /**
   * The single shadow-casting key light.
   *
   * Raised alongside the ambient cut. With less fill, the key has to do more of the work of
   * separating surfaces from each other, and a strong directional is what produces the long shadows
   * that make a large space read as large.
   */
  keyLightIntensity: 1.55,
  keyLightColor: 0xbfd8ff,
  keyLightPosition: [18, 34, 12] as const,
} as const;

/**
 * Luminance bands the probe grades against.
 *
 * `darkRoomMax` is what makes a designed dark room verifiable: below it the space genuinely reads
 * as unlit, while `blackFloor` is the point at which it stops being atmosphere and becomes a bug.
 */
export const LUMINANCE_TARGETS = {
  blackFloor: 0.035,
  darkRoomMax: 0.13,
  playableMin: 0.12,
  playableMax: 0.62,
} as const;
