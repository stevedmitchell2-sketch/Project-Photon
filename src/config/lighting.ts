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
   * Global fill. Deliberately restrained: ambient cannot be masked per-room, so a generous term
   * makes an unlit space impossible — a dark room reads exactly as bright as the lit floor. Low
   * fill plus the arena's own fixtures is what gives the level light and shade.
   */
  ambientIntensity: 0.42,
  hemisphereIntensity: 0.3,

  /** Image-based lighting. Required for metallic surfaces to render as anything but black. */
  environmentIntensity: 0.6,
  environmentIntensityPerformance: 0.45,

  /** ACES rolls midtones down hard; above 1 keeps mid-dark surfaces off the floor of the curve. */
  toneMappingExposure: 1.35,

  /** The single shadow-casting key light. */
  keyLightIntensity: 1.1,
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
