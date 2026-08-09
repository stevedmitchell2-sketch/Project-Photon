export type QualityPreset = 'performance' | 'balanced' | 'quality';

export interface GraphicsSettings {
  preset: QualityPreset;
  /** Vertical FOV in degrees at hip fire. */
  fov: number;
  renderScale: number;
  bloom: boolean;
  bloomIntensity: number;
  volumetricLight: boolean;
  shadows: boolean;
  shadowMapSize: number;
  motionBlur: boolean;
  chromaticAberration: boolean;
  vignette: boolean;
  filmGrain: boolean;
  colorGrading: boolean;
  maxDynamicLights: number;
  fogEnabled: boolean;
  /** Prefer the WebGPU backend when the browser exposes it. */
  preferWebGPU: boolean;
  targetFps: 60 | 120 | 144 | 0;
  showFps: boolean;
}

/**
 * Quality presets.
 *
 * `bloomIntensity` was reduced across the board in Sprint 8 (0.55/0.85/1.1 -> 0.35/0.5/0.68). This
 * is a readability change, not a performance one: GPU timing showed the bloom pass costs
 * essentially nothing, but at the old intensities the emissive light fixtures bled into two large
 * white-cyan blooms that sat in the middle of the screen from most positions on the deck and washed
 * out anything behind them — including whatever was under the crosshair. The neon still reads as
 * neon at the lower values; it just stops eating the frame.
 *
 * The frame is fragment-bound, so `renderScale` and `maxDynamicLights` are the two settings that
 * actually move GPU time here. See RENDERING_GUIDE.md for the measured attribution.
 */
export const QUALITY_PRESETS: Record<QualityPreset, Partial<GraphicsSettings>> = {
  performance: {
    renderScale: 0.75,
    bloom: true,
    bloomIntensity: 0.35,
    volumetricLight: false,
    shadows: false,
    shadowMapSize: 512,
    motionBlur: false,
    chromaticAberration: false,
    vignette: true,
    filmGrain: false,
    colorGrading: false,
    maxDynamicLights: 4,
    fogEnabled: true,
  },
  balanced: {
    renderScale: 1,
    bloom: true,
    bloomIntensity: 0.5,
    volumetricLight: true,
    shadows: true,
    shadowMapSize: 1024,
    motionBlur: false,
    chromaticAberration: true,
    vignette: true,
    filmGrain: true,
    colorGrading: true,
    maxDynamicLights: 8,
    fogEnabled: true,
  },
  quality: {
    renderScale: 1,
    bloom: true,
    bloomIntensity: 0.68,
    volumetricLight: true,
    shadows: true,
    shadowMapSize: 2048,
    motionBlur: true,
    chromaticAberration: true,
    vignette: true,
    filmGrain: true,
    colorGrading: true,
    maxDynamicLights: 12,
    fogEnabled: true,
  },
};

export const defaultGraphicsSettings = (): GraphicsSettings => ({
  preset: 'balanced',
  /**
   * Vertical FOV. three.js `PerspectiveCamera.fov` is vertical, which is the fact this was set
   * without: at the 1.6 aspect the game runs at, 95 vertical is **120 degrees horizontal**. Modern
   * console shooters sit near 100-110, and 120 is what made the weapon read as a toy stuck to the
   * camera — an extreme FOV shrinks the view model and stretches perspective at the same time.
   *
   * 75 vertical is ~102 horizontal. Measured by guarded A/B at an identical rAF-pinned camera
   * (captures 70 at 95, 72 at 75): the rifle gains real presence in the lower right, the arena reads
   * with depth instead of fisheye stretch, and the central landmark holds the frame.
   *
   * The 80 arm was withheld by the capture guard at 18.7 mm drift against a 15 mm tolerance, so
   * ~107 horizontal is untested and may yet be the better landing point.
   */
  fov: 75,
  renderScale: 1,
  bloom: true,
  // Must match the `balanced` preset — this is the value a fresh install starts on.
  bloomIntensity: 0.5,
  volumetricLight: true,
  shadows: true,
  shadowMapSize: 1024,
  motionBlur: false,
  chromaticAberration: true,
  vignette: true,
  filmGrain: true,
  colorGrading: true,
  maxDynamicLights: 8,
  fogEnabled: true,
  preferWebGPU: true,
  targetFps: 0,
  showFps: true,
});

export const applyPreset = (
  settings: GraphicsSettings,
  preset: QualityPreset,
): GraphicsSettings => ({
  ...settings,
  ...QUALITY_PRESETS[preset],
  preset,
});
