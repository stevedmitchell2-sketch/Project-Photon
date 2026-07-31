import { TEAMS, teamEmissiveCss } from '@/config/teams';
import { useSettings } from '@/state/settingsStore';
import { useUi } from '@/state/uiStore';

export function LoadingScreen() {
  const message = useUi((s) => s.loadingMessage);
  const progress = useUi((s) => s.loadingProgress);
  return (
    <div className="loading">
      <div style={{ fontSize: 34, letterSpacing: '0.4em', color: '#eaf7ff' }}>PHOTON</div>
      <div className="loading__bar">
        <div className="loading__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <div className="loading__label">{message}</div>
    </div>
  );
}

export function PauseMenu({
  onResume,
  onSettings,
  onQuit,
}: {
  onResume: () => void;
  onSettings: () => void;
  onQuit: () => void;
}) {
  return (
    <div className="menu">
      <div className="menu__panel" style={{ width: 'min(460px, 92vw)' }}>
        <h1 className="menu__title" style={{ fontSize: 30 }}>
          PAUSED
        </h1>
        <div className="menu__subtitle">The match continues while you are here</div>
        <div className="menu__actions" style={{ flexDirection: 'column' }}>
          <button className="btn btn--primary" onClick={onResume}>
            Resume
          </button>
          <button className="btn" onClick={onSettings}>
            Settings
          </button>
          <button className="btn btn--danger" onClick={onQuit}>
            Leave Match
          </button>
        </div>
      </div>
    </div>
  );
}

export function Scoreboard() {
  const rows = useUi((s) => s.scoreboard);
  const colorblind = useSettings((s) => s.accessibility.colorblindPalette);

  return (
    <div className="scoreboard">
      <div className="scoreboard__panel">
        <table className="scoreboard__table">
          <thead>
            <tr>
              <th>Operator</th>
              <th style={{ width: 70 }}>Tags</th>
              <th style={{ width: 70 }}>Downs</th>
              <th style={{ width: 70 }}>Assists</th>
              <th style={{ width: 70 }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.isLocal ? 'scoreboard__row--local' : undefined}>
                <td style={{ color: teamEmissiveCss(row.team, colorblind) }}>
                  {TEAMS[row.team].glyph} {row.name}
                  {row.isBot && <span className="scoreboard__tag">BOT</span>}
                </td>
                <td>{row.kills}</td>
                <td>{row.deaths}</td>
                <td>{row.assists}</td>
                <td>{row.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ResultsScreen({ onRematch, onExit }: { onRematch: () => void; onExit: () => void }) {
  const result = useUi((s) => s.matchResult);
  const rows = useUi((s) => s.scoreboard);
  const colorblind = useSettings((s) => s.accessibility.colorblindPalette);

  return (
    <div className="menu">
      <div className="menu__panel">
        <h1
          className="menu__title"
          style={{
            fontSize: 38,
            color: result?.winner ? teamEmissiveCss(result.winner, colorblind) : '#eaf7ff',
          }}
        >
          {result?.winner ? `${TEAMS[result.winner].name.toUpperCase()} WINS` : 'DRAW'}
        </h1>
        <div className="menu__subtitle">Match complete</div>

        <div className="menu__section">
          <div className="menu__section-title">Final scores</div>
          <div className="scoreboard-strip">
            {result?.scores.map((entry) => (
              <div
                key={entry.team}
                className="score-chip"
                style={{ color: teamEmissiveCss(entry.team, colorblind) }}
              >
                <span className="score-chip__glyph">{TEAMS[entry.team].glyph}</span>
                <span>{entry.score}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="menu__section">
          <div className="menu__section-title">Operators</div>
          <table className="scoreboard__table">
            <thead>
              <tr>
                <th>Operator</th>
                <th style={{ width: 70 }}>Tags</th>
                <th style={{ width: 70 }}>Downs</th>
                <th style={{ width: 70 }}>Assists</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.isLocal ? 'scoreboard__row--local' : undefined}>
                  <td style={{ color: teamEmissiveCss(row.team, colorblind) }}>
                    {TEAMS[row.team].glyph} {row.name}
                    {row.isBot && <span className="scoreboard__tag">BOT</span>}
                  </td>
                  <td>{row.kills}</td>
                  <td>{row.deaths}</td>
                  <td>{row.assists}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="menu__actions">
          <button className="btn btn--primary" onClick={onRematch}>
            Rematch
          </button>
          <button className="btn" onClick={onExit}>
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}
