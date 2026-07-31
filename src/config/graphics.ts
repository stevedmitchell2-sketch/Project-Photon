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

export const QUALITY_PRESETS: Record<QualityPreset, Partial<GraphicsSettings>> = {
  performance: {
    renderScale: 0.75,
    bloom: true,
    bloomIntensity: 0.55,
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
    bloomIntensity: 0.85,
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
    bloomIntensity: 1.1,
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
  fov: 95,
  renderScale: 1,
  bloom: true,
  bloomIntensity: 0.85,
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
