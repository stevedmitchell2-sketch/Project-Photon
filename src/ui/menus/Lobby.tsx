import { GAME_MODES, type GameModeId } from '@/config/gameModes';
import { TEAMS, TEAM_IDS, teamCss, type TeamId } from '@/config/teams';
import { ARENAS } from '@/maps/MapBuilder';
import { useSettings } from '@/state/settingsStore';
import { useUi } from '@/state/uiStore';

export function Lobby({ onStart }: { onStart: () => void }) {
  const settings = useUi((s) => s.matchSettings);
  const patch = useUi((s) => s.setMatchSettings);
  const setScreen = useUi((s) => s.setScreen);
  const colorblind = useSettings((s) => s.accessibility.colorblindPalette);

  const mode = GAME_MODES[settings.mode];
  const activeTeams = settings.teams;

  const selectMode = (id: GameModeId) => {
    const next = GAME_MODES[id];
    // Adopt the mode's defaults, then let the player override them below.
    patch({
      mode: id,
      scoreLimit: next.scoreLimit,
      timeLimitSeconds: next.timeLimitSeconds,
      respawnSeconds: next.respawnSeconds,
      friendlyFire: next.friendlyFire,
      teams: TEAM_IDS.slice(0, next.teamCount) as TeamId[],
      playerTeam: TEAM_IDS[0],
    });
  };

  const setTeamCount = (count: number) => {
    const teams = TEAM_IDS.slice(0, count) as TeamId[];
    patch({
      teams,
      playerTeam: teams.includes(settings.playerTeam) ? settings.playerTeam : teams[0],
    });
  };

  return (
    <div className="menu">
      <div className="menu__panel">
        <h1 className="menu__title" style={{ fontSize: 32 }}>
          MATCH SETUP
        </h1>
        <div className="menu__subtitle">Configure the engagement</div>

        <div className="menu__section">
          <div className="menu__section-title">Mode</div>
          <div className="menu__row">
            <div className="menu__row-label">
              Game mode
              <span className="menu__row-hint">{mode.description}</span>
            </div>
            <select
              className="field"
              value={settings.mode}
              onChange={(e) => selectMode(e.target.value as GameModeId)}
            >
              {Object.values(GAME_MODES).map((m) => (
                <option key={m.id} value={m.id} disabled={!m.implemented}>
                  {m.name}
                  {m.implemented ? '' : ' — milestone 2'}
                </option>
              ))}
            </select>
          </div>

          <div className="menu__row">
            <div className="menu__row-label">
              Arena
              <span className="menu__row-hint">
                {ARENAS[settings.arena]?.description ?? ''}
              </span>
            </div>
            <select
              className="field"
              value={settings.arena}
              onChange={(e) => patch({ arena: e.target.value })}
            >
              {Object.values(ARENAS).map((arena) => (
                <option key={arena.id} value={arena.id}>
                  {arena.name}
                </option>
              ))}
              <option disabled>Cyber Factory — milestone 3</option>
              <option disabled>Space Station — milestone 3</option>
              <option disabled>Neon Temple — milestone 3</option>
            </select>
          </div>
        </div>

        <div className="menu__section">
          <div className="menu__section-title">Teams</div>
          <div className="menu__row">
            <div className="menu__row-label">Number of teams</div>
            <select
              className="field"
              value={activeTeams.length}
              disabled={mode.freeForAll}
              onChange={(e) => setTeamCount(Number(e.target.value))}
            >
              <option value={2}>2 teams</option>
              <option value={3}>3 teams</option>
              <option value={4}>4 teams</option>
            </select>
          </div>

          <div className="menu__row">
            <div className="menu__row-label">Your team</div>
            <div className="team-pick">
              {activeTeams.map((team) => (
                <button
                  key={team}
                  className={`team-pick__option${settings.playerTeam === team ? ' team-pick__option--active' : ''}`}
                  style={{
                    color: teamCss(team, colorblind),
                    borderColor: teamCss(team, colorblind),
                  }}
                  onClick={() => patch({ playerTeam: team })}
                >
                  {TEAMS[team].glyph} {TEAMS[team].name}
                </button>
              ))}
            </div>
          </div>

          <div className="menu__row">
            <div className="menu__row-label">
              Players per team
              <span className="menu__row-hint">Includes you on your own team</span>
            </div>
            <input
              className="field"
              type="range"
              min={1}
              max={mode.maxPlayersPerTeam}
              value={settings.botsPerTeam}
              onChange={(e) => patch({ botsPerTeam: Number(e.target.value) })}
            />
          </div>
          <div className="menu__row">
            <div className="menu__row-label" />
            <div style={{ fontSize: 13, color: '#a9c0d4' }}>{settings.botsPerTeam} per team</div>
          </div>
        </div>

        <div className="menu__section">
          <div className="menu__section-title">Rules</div>

          <div className="menu__row">
            <div className="menu__row-label">Score limit</div>
            <input
              className="field"
              type="number"
              min={1}
              max={500}
              value={settings.scoreLimit}
              onChange={(e) => patch({ scoreLimit: Number(e.target.value) })}
            />
          </div>

          <div className="menu__row">
            <div className="menu__row-label">Time limit (minutes)</div>
            <input
              className="field"
              type="number"
              min={1}
              max={60}
              value={Math.round(settings.timeLimitSeconds / 60)}
              onChange={(e) => patch({ timeLimitSeconds: Number(e.target.value) * 60 })}
            />
          </div>

          <div className="menu__row">
            <div className="menu__row-label">Respawn delay (seconds)</div>
            <input
              className="field"
              type="number"
              min={0}
              max={30}
              value={settings.respawnSeconds}
              onChange={(e) => patch({ respawnSeconds: Number(e.target.value) })}
            />
          </div>

          <div className="menu__row">
            <div className="menu__row-label">Friendly fire</div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.friendlyFire}
                onChange={(e) => patch({ friendlyFire: e.target.checked })}
              />
              Enabled
            </label>
          </div>

          <div className="menu__row">
            <div className="menu__row-label">Bots</div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.botsEnabled}
                onChange={(e) => patch({ botsEnabled: e.target.checked })}
              />
              Fill teams with bots
            </label>
          </div>

          <div className="menu__row">
            <div className="menu__row-label">Bot difficulty</div>
            <select
              className="field"
              value={settings.botDifficulty}
              disabled={!settings.botsEnabled}
              onChange={(e) =>
                patch({ botDifficulty: e.target.value as typeof settings.botDifficulty })
              }
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
              <option value="expert">Expert</option>
            </select>
          </div>
        </div>

        <div className="menu__actions">
          <button className="btn btn--primary" onClick={onStart}>
            Deploy
          </button>
          <button className="btn" onClick={() => setScreen('main_menu')}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
