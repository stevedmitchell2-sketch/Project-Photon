import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultGraphicsSettings, applyPreset, type GraphicsSettings, type QualityPreset } from '@/config/graphics';
import { defaultInputSettings, type InputSettings } from '@/input/InputManager';
import { defaultMixSettings, type AudioMixSettings } from '@/audio/AudioEngine';
import type { GameAction } from '@/input/bindings';

export interface AccessibilitySettings {
  colorblindPalette: boolean;
  subtitles: boolean;
  subtitleSize: 'small' | 'medium' | 'large';
  reduceCameraShake: boolean;
  reduceViewBob: boolean;
  highContrastHud: boolean;
  /** Extra outline pass on enemies for low-vision players. */
  enemyOutlines: boolean;
}

export interface CrosshairSettings {
  style: 'cross' | 'dot' | 'circle' | 'chevron';
  size: number;
  thickness: number;
  gap: number;
  color: string;
  outline: boolean;
  dynamic: boolean;
  showHitMarker: boolean;
}

interface SettingsState {
  graphics: GraphicsSettings;
  input: InputSettings;
  audio: AudioMixSettings;
  accessibility: AccessibilitySettings;
  crosshair: CrosshairSettings;
  playerName: string;

  setGraphics(patch: Partial<GraphicsSettings>): void;
  setQualityPreset(preset: QualityPreset): void;
  setInput(patch: Partial<InputSettings>): void;
  setAudio(patch: Partial<AudioMixSettings>): void;
  setAccessibility(patch: Partial<AccessibilitySettings>): void;
  setCrosshair(patch: Partial<CrosshairSettings>): void;
  setPlayerName(name: string): void;
  rebind(code: string, action: GameAction): void;
  resetBindings(): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      graphics: defaultGraphicsSettings(),
      input: defaultInputSettings(),
      audio: defaultMixSettings(),
      accessibility: {
        colorblindPalette: false,
        subtitles: true,
        subtitleSize: 'medium',
        reduceCameraShake: false,
        reduceViewBob: false,
        highContrastHud: false,
        enemyOutlines: false,
      },
      crosshair: {
        style: 'cross',
        size: 9,
        thickness: 2,
        gap: 5,
        color: '#4de3ff',
        outline: true,
        dynamic: true,
        showHitMarker: true,
      },
      playerName: 'OPERATOR',

      setGraphics: (patch) => set((s) => ({ graphics: { ...s.graphics, ...patch } })),
      setQualityPreset: (preset) => set((s) => ({ graphics: applyPreset(s.graphics, preset) })),
      setInput: (patch) => set((s) => ({ input: { ...s.input, ...patch } })),
      setAudio: (patch) => set((s) => ({ audio: { ...s.audio, ...patch } })),
      setAccessibility: (patch) => set((s) => ({ accessibility: { ...s.accessibility, ...patch } })),
      setCrosshair: (patch) => set((s) => ({ crosshair: { ...s.crosshair, ...patch } })),
      setPlayerName: (playerName) => set({ playerName: playerName.slice(0, 16).toUpperCase() }),

      rebind: (code, action) =>
        set((s) => {
          const bindings = { ...s.input.keyBindings };
          // A physical input maps to exactly one action; clear whatever else claimed it.
          for (const [existingCode, existingAction] of Object.entries(bindings)) {
            if (existingAction === action) delete bindings[existingCode];
          }
          bindings[code] = action;
          return { input: { ...s.input, keyBindings: bindings } };
        }),

      resetBindings: () =>
        set((s) => ({
          input: {
            ...s.input,
            keyBindings: defaultInputSettings().keyBindings,
            padBindings: defaultInputSettings().padBindings,
          },
        })),
    }),
    {
      name: 'photon.settings.v1',
      /**
       * Bumped to 2 to retire a persisted FOV that was a bug rather than a preference.
       *
       * v1 shipped `fov: 95` believing it was horizontal. `PerspectiveCamera.fov` is **vertical**, so
       * at the game's 1.6 aspect that is 120 degrees horizontal — far outside the 100-110 a console
       * shooter sits at, and the reason the view model read as a toy stuck to the camera.
       *
       * `merge` below deliberately lets a persisted value win over a new default, which is correct
       * for a preference and wrong for a mistake: changing the default alone left every existing
       * session on 120. So the migration drops *only* `graphics.fov` and leaves every other stored
       * preference intact, letting the corrected default apply once.
       *
       * Anyone who genuinely wants a wide FOV can set it again; nobody chose 120 on purpose.
       */
      version: 2,
      migrate: (persisted, fromVersion) => {
        const p = persisted as Partial<SettingsState> | undefined;
        if (!p || fromVersion >= 2 || !p.graphics) return p as SettingsState;
        const graphics = { ...p.graphics };
        delete (graphics as Partial<GraphicsSettings>).fov;
        return { ...p, graphics } as SettingsState;
      },
      // Merge rather than replace so new settings added in a patch get their defaults.
      merge: (persisted, current) => {
        const p = persisted as Partial<SettingsState> | undefined;
        if (!p) return current;
        return {
          ...current,
          ...p,
          graphics: { ...current.graphics, ...p.graphics },
          input: { ...current.input, ...p.input },
          audio: { ...current.audio, ...p.audio },
          accessibility: { ...current.accessibility, ...p.accessibility },
          crosshair: { ...current.crosshair, ...p.crosshair },
        };
      },
    },
  ),
);
