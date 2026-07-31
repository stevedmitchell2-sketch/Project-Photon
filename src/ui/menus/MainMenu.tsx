import { useSettings } from '@/state/settingsStore';
import { useUi } from '@/state/uiStore';

export function MainMenu() {
  const setScreen = useUi((s) => s.setScreen);
  const playerName = useSettings((s) => s.playerName);
  const setPlayerName = useSettings((s) => s.setPlayerName);

  return (
    <div className="menu">
      <div className="menu__panel">
        <h1 className="menu__title">PHOTON</h1>
        <div className="menu__subtitle">Laser tag combat · Arena protocol v0.1</div>

        <div className="menu__section">
          <div className="menu__row">
            <div className="menu__row-label">
              Callsign
              <span className="menu__row-hint">Shown in the killfeed and scoreboard</span>
            </div>
            <input
              className="field"
              value={playerName}
              maxLength={16}
              onChange={(e) => setPlayerName(e.target.value)}
            />
          </div>
        </div>

        <div className="menu__actions">
          <button className="btn btn--primary" onClick={() => setScreen('lobby')}>
            Enter Arena
          </button>
          <button className="btn" onClick={() => setScreen('settings')}>
            Settings
          </button>
        </div>

        <div className="menu__section" style={{ marginTop: 34 }}>
          <div className="menu__section-title">Controls</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 26px', fontSize: 13, color: '#a9c0d4' }}>
            <span>WASD — Move</span>
            <span>Shift — Sprint</span>
            <span>Space — Jump / Mantle</span>
            <span>Ctrl or C — Crouch, slide while sprinting</span>
            <span>Q / E — Lean</span>
            <span>R — Vent and recharge</span>
            <span>Left Mouse — Fire</span>
            <span>Right Mouse — Aim</span>
            <span>Tab — Scoreboard</span>
            <span>Esc — Pause</span>
          </div>
        </div>
      </div>
    </div>
  );
}
