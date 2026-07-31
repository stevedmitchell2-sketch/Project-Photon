import { useEffect, useState } from 'react';
import type { QualityPreset } from '@/config/graphics';
import { ACTION_LABELS, codeLabel, type GameAction } from '@/input/bindings';
import { useSettings } from '@/state/settingsStore';

type Tab = 'video' | 'controls' | 'audio' | 'crosshair' | 'accessibility' | 'bindings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'video', label: 'Video' },
  { id: 'controls', label: 'Controls' },
  { id: 'audio', label: 'Audio' },
  { id: 'crosshair', label: 'Crosshair' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'bindings', label: 'Key Bindings' },
];

export function SettingsMenu({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('video');

  return (
    <div className="menu">
      <div className="menu__panel">
        <h1 className="menu__title" style={{ fontSize: 32 }}>
          SETTINGS
        </h1>
        <div className="menu__subtitle">Changes apply immediately and persist locally</div>

        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab${tab === t.id ? ' tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'video' && <VideoTab />}
        {tab === 'controls' && <ControlsTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'crosshair' && <CrosshairTab />}
        {tab === 'accessibility' && <AccessibilityTab />}
        {tab === 'bindings' && <BindingsTab />}

        <div className="menu__actions">
          <button className="btn btn--primary" onClick={onClose}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="menu__row">
      <div className="menu__row-label">
        {label}
        {hint && <span className="menu__row-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <input
        className="field"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span style={{ fontSize: 12, color: '#a9c0d4', minWidth: 48, textAlign: 'right' }}>
        {format ? format(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

function VideoTab() {
  const graphics = useSettings((s) => s.graphics);
  const setGraphics = useSettings((s) => s.setGraphics);
  const setPreset = useSettings((s) => s.setQualityPreset);

  return (
    <div className="menu__section">
      <Row label="Quality preset" hint="Performance mode halves render scale and drops post effects">
        <select
          className="field"
          value={graphics.preset}
          onChange={(e) => setPreset(e.target.value as QualityPreset)}
        >
          <option value="performance">Performance</option>
          <option value="balanced">Balanced</option>
          <option value="quality">Quality</option>
        </select>
      </Row>

      <Row label="Field of view" hint="Vertical FOV at hip fire">
        <Slider
          value={graphics.fov}
          min={70}
          max={120}
          step={1}
          onChange={(fov) => setGraphics({ fov })}
          format={(v) => `${v.toFixed(0)}°`}
        />
      </Row>

      <Row label="Render scale">
        <Slider
          value={graphics.renderScale}
          min={0.5}
          max={1}
          step={0.05}
          onChange={(renderScale) => setGraphics({ renderScale })}
          format={(v) => `${(v * 100).toFixed(0)}%`}
        />
      </Row>

      <Row label="Bloom intensity">
        <Slider
          value={graphics.bloomIntensity}
          min={0}
          max={2}
          onChange={(bloomIntensity) => setGraphics({ bloomIntensity, bloom: bloomIntensity > 0 })}
        />
      </Row>

      <Row label="Dynamic shadows">
        <label className="toggle">
          <input
            type="checkbox"
            checked={graphics.shadows}
            onChange={(e) => setGraphics({ shadows: e.target.checked })}
          />
          Enabled
        </label>
      </Row>

      <Row label="Volumetric light">
        <label className="toggle">
          <input
            type="checkbox"
            checked={graphics.volumetricLight}
            onChange={(e) => setGraphics({ volumetricLight: e.target.checked })}
          />
          Enabled
        </label>
      </Row>

      <Row label="Motion blur">
        <label className="toggle">
          <input
            type="checkbox"
            checked={graphics.motionBlur}
            onChange={(e) => setGraphics({ motionBlur: e.target.checked })}
          />
          Enabled
        </label>
      </Row>

      <Row label="Chromatic aberration">
        <label className="toggle">
          <input
            type="checkbox"
            checked={graphics.chromaticAberration}
            onChange={(e) => setGraphics({ chromaticAberration: e.target.checked })}
          />
          Enabled
        </label>
      </Row>

      <Row label="Film grain">
        <label className="toggle">
          <input
            type="checkbox"
            checked={graphics.filmGrain}
            onChange={(e) => setGraphics({ filmGrain: e.target.checked })}
          />
          Enabled
        </label>
      </Row>

      <Row label="Max dynamic lights">
        <Slider
          value={graphics.maxDynamicLights}
          min={2}
          max={16}
          step={1}
          onChange={(maxDynamicLights) => setGraphics({ maxDynamicLights })}
          format={(v) => v.toFixed(0)}
        />
      </Row>

      <Row label="Show performance readout">
        <label className="toggle">
          <input
            type="checkbox"
            checked={graphics.showFps}
            onChange={(e) => setGraphics({ showFps: e.target.checked })}
          />
          Enabled
        </label>
      </Row>
    </div>
  );
}

function ControlsTab() {
  const input = useSettings((s) => s.input);
  const setInput = useSettings((s) => s.setInput);

  return (
    <div className="menu__section">
      <Row label="Mouse sensitivity">
        <Slider
          value={input.mouseSensitivity}
          min={0.1}
          max={4}
          onChange={(mouseSensitivity) => setInput({ mouseSensitivity })}
        />
      </Row>
      <Row label="Gamepad sensitivity">
        <Slider
          value={input.padSensitivity}
          min={0.5}
          max={8}
          onChange={(padSensitivity) => setInput({ padSensitivity })}
        />
      </Row>
      <Row label="Stick deadzone" hint="Radial deadzone applied before the response curve">
        <Slider
          value={input.stickDeadzone}
          min={0}
          max={0.4}
          onChange={(stickDeadzone) => setInput({ stickDeadzone })}
        />
      </Row>
      <Row label="Stick response curve" hint="Higher values give finer control near centre">
        <Slider
          value={input.stickResponseCurve}
          min={1}
          max={3}
          onChange={(stickResponseCurve) => setInput({ stickResponseCurve })}
        />
      </Row>
      <Row label="Invert vertical look">
        <label className="toggle">
          <input
            type="checkbox"
            checked={input.invertY}
            onChange={(e) => setInput({ invertY: e.target.checked })}
          />
          Enabled
        </label>
      </Row>
      <Row label="Sprint">
        <label className="toggle">
          <input
            type="checkbox"
            checked={input.toggleSprint}
            onChange={(e) => setInput({ toggleSprint: e.target.checked })}
          />
          Toggle instead of hold
        </label>
      </Row>
      <Row label="Crouch">
        <label className="toggle">
          <input
            type="checkbox"
            checked={input.toggleCrouch}
            onChange={(e) => setInput({ toggleCrouch: e.target.checked })}
          />
          Toggle instead of hold
        </label>
      </Row>
      <Row label="Aim down sights">
        <label className="toggle">
          <input
            type="checkbox"
            checked={input.toggleAds}
            onChange={(e) => setInput({ toggleAds: e.target.checked })}
          />
          Toggle instead of hold
        </label>
      </Row>
      <Row label="Controller vibration">
        <label className="toggle">
          <input
            type="checkbox"
            checked={input.rumbleEnabled}
            onChange={(e) => setInput({ rumbleEnabled: e.target.checked })}
          />
          Enabled
        </label>
      </Row>
      <Row label="Vibration strength">
        <Slider
          value={input.rumbleStrength}
          min={0}
          max={1}
          onChange={(rumbleStrength) => setInput({ rumbleStrength })}
        />
      </Row>
    </div>
  );
}

function AudioTab() {
  const audio = useSettings((s) => s.audio);
  const setAudio = useSettings((s) => s.setAudio);
  const format = (v: number) => `${(v * 100).toFixed(0)}%`;

  return (
    <div className="menu__section">
      <Row label="Master volume">
        <Slider value={audio.master} min={0} max={1} onChange={(master) => setAudio({ master })} format={format} />
      </Row>
      <Row label="Effects">
        <Slider value={audio.sfx} min={0} max={1} onChange={(sfx) => setAudio({ sfx })} format={format} />
      </Row>
      <Row label="Music" hint="Adaptive score, intensity follows nearby combat">
        <Slider value={audio.music} min={0} max={1} onChange={(music) => setAudio({ music })} format={format} />
      </Row>
      <Row label="Announcer">
        <Slider value={audio.voice} min={0} max={1} onChange={(voice) => setAudio({ voice })} format={format} />
      </Row>
    </div>
  );
}

function CrosshairTab() {
  const crosshair = useSettings((s) => s.crosshair);
  const setCrosshair = useSettings((s) => s.setCrosshair);

  return (
    <div className="menu__section">
      <Row label="Style">
        <select
          className="field"
          value={crosshair.style}
          onChange={(e) => setCrosshair({ style: e.target.value as typeof crosshair.style })}
        >
          <option value="cross">Cross</option>
          <option value="dot">Dot</option>
          <option value="circle">Circle</option>
          <option value="chevron">Chevron</option>
        </select>
      </Row>
      <Row label="Size">
        <Slider value={crosshair.size} min={2} max={24} step={1} onChange={(size) => setCrosshair({ size })} format={(v) => v.toFixed(0)} />
      </Row>
      <Row label="Thickness">
        <Slider value={crosshair.thickness} min={1} max={6} step={1} onChange={(thickness) => setCrosshair({ thickness })} format={(v) => v.toFixed(0)} />
      </Row>
      <Row label="Gap">
        <Slider value={crosshair.gap} min={0} max={20} step={1} onChange={(gap) => setCrosshair({ gap })} format={(v) => v.toFixed(0)} />
      </Row>
      <Row label="Colour">
        <input
          className="field"
          type="color"
          value={crosshair.color}
          onChange={(e) => setCrosshair({ color: e.target.value })}
        />
      </Row>
      <Row label="Expand with spread" hint="Reticle widens as accuracy degrades">
        <label className="toggle">
          <input
            type="checkbox"
            checked={crosshair.dynamic}
            onChange={(e) => setCrosshair({ dynamic: e.target.checked })}
          />
          Enabled
        </label>
      </Row>
      <Row label="Hit marker">
        <label className="toggle">
          <input
            type="checkbox"
            checked={crosshair.showHitMarker}
            onChange={(e) => setCrosshair({ showHitMarker: e.target.checked })}
          />
          Enabled
        </label>
      </Row>
    </div>
  );
}

function AccessibilityTab() {
  const a11y = useSettings((s) => s.accessibility);
  const set = useSettings((s) => s.setAccessibility);

  return (
    <div className="menu__section">
      <Row
        label="Colourblind palette"
        hint="Swaps team colours for a high-separation set; team glyphs stay unchanged"
      >
        <label className="toggle">
          <input
            type="checkbox"
            checked={a11y.colorblindPalette}
            onChange={(e) => set({ colorblindPalette: e.target.checked })}
          />
          Enabled
        </label>
      </Row>
      <Row label="Subtitles" hint="Announcements shown as on-screen text">
        <label className="toggle">
          <input type="checkbox" checked={a11y.subtitles} onChange={(e) => set({ subtitles: e.target.checked })} />
          Enabled
        </label>
      </Row>
      <Row label="Subtitle size">
        <select
          className="field"
          value={a11y.subtitleSize}
          onChange={(e) => set({ subtitleSize: e.target.value as typeof a11y.subtitleSize })}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </Row>
      <Row label="Reduce camera shake">
        <label className="toggle">
          <input
            type="checkbox"
            checked={a11y.reduceCameraShake}
            onChange={(e) => set({ reduceCameraShake: e.target.checked })}
          />
          Enabled
        </label>
      </Row>
      <Row label="Reduce view bob">
        <label className="toggle">
          <input
            type="checkbox"
            checked={a11y.reduceViewBob}
            onChange={(e) => set({ reduceViewBob: e.target.checked })}
          />
          Enabled
        </label>
      </Row>
      <Row label="High contrast HUD">
        <label className="toggle">
          <input
            type="checkbox"
            checked={a11y.highContrastHud}
            onChange={(e) => set({ highContrastHud: e.target.checked })}
          />
          Enabled
        </label>
      </Row>
      <Row label="Enemy outlines">
        <label className="toggle">
          <input
            type="checkbox"
            checked={a11y.enemyOutlines}
            onChange={(e) => set({ enemyOutlines: e.target.checked })}
          />
          Enabled
        </label>
      </Row>
    </div>
  );
}

function BindingsTab() {
  const bindings = useSettings((s) => s.input.keyBindings);
  const rebind = useSettings((s) => s.rebind);
  const reset = useSettings((s) => s.resetBindings);
  const [listening, setListening] = useState<GameAction | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code !== 'Escape') rebind(e.code, listening);
      setListening(null);
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      rebind(`Mouse${e.button}`, listening);
      setListening(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('mousedown', onMouse, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('mousedown', onMouse, { capture: true });
    };
  }, [listening, rebind]);

  const codeFor = (action: GameAction): string | undefined =>
    Object.entries(bindings).find(([, a]) => a === action)?.[0];

  return (
    <div className="menu__section">
      <div className="keybind-list">
        {(Object.keys(ACTION_LABELS) as GameAction[])
          .filter((action) => action !== 'slide')
          .map((action) => {
            const code = codeFor(action);
            return (
              <div key={action} className="keybind-row">
                <span>{ACTION_LABELS[action]}</span>
                <button
                  className={`keybind-row__key${listening === action ? ' keybind-row__key--listening' : ''}`}
                  onClick={() => setListening(action)}
                >
                  {listening === action ? 'Press any key…' : code ? codeLabel(code) : 'Unbound'}
                </button>
              </div>
            );
          })}
      </div>
      <div className="menu__actions">
        <button className="btn btn--small" onClick={reset}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
