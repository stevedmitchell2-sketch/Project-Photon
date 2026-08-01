import { useEffect, useState } from 'react';
import { COMBAT } from '@/config/combat';
import { TEAMS, teamCss, teamEmissiveCss } from '@/config/teams';
import type { Game } from '@/engine/Game';
import { useSettings } from '@/state/settingsStore';
import { useUi, type HudSnapshot } from '@/state/uiStore';
import { Crosshair } from './Crosshair';
import { Minimap } from './Minimap';
import { NetOverlay } from './NetOverlay';

/**
 * Developer overlay toggle. F3 cycles off -> compact -> full, so a playtester can surface network
 * diagnostics mid-match without opening a menu and losing pointer lock.
 */
function useNetOverlayMode(): 'off' | 'compact' | 'full' {
  const [mode, setMode] = useState<'off' | 'compact' | 'full'>('off');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'F3') return;
      e.preventDefault();
      setMode((m) => (m === 'off' ? 'compact' : m === 'compact' ? 'full' : 'off'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return mode;
}

const formatTime = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function Hud({ game }: { game: Game }) {
  const hud = useUi((s) => s.hud);
  const killFeed = useUi((s) => s.killFeed);
  const subtitle = useUi((s) => s.subtitle);
  const damageIndicators = useUi((s) => s.damageIndicators);
  const notifications = useUi((s) => s.notifications);
  const crosshair = useSettings((s) => s.crosshair);
  const accessibility = useSettings((s) => s.accessibility);
  const graphics = useSettings((s) => s.graphics);
  const colorblind = accessibility.colorblindPalette;
  const netOverlayMode = useNetOverlayMode();

  const teamColor = teamEmissiveCss(hud.team, colorblind);

  return (
    <div className={`hud${accessibility.highContrastHud ? ' hud--contrast' : ''}`}>
      <Crosshair settings={crosshair} />
      <DamageIndicators indicators={damageIndicators} game={game} />

      {/* Top centre: timer and team scores */}
      <div style={{ position: 'absolute', left: '50%', top: 18, transform: 'translateX(-50%)' }}>
        <div className={`match-timer${hud.timeRemaining < 60 ? ' match-timer--urgent' : ''}`}>
          {formatTime(hud.timeRemaining)}
        </div>
        <div className="scoreboard-strip" style={{ marginTop: 8 }}>
          {hud.scores.map((entry) => (
            <div
              key={entry.key}
              className="score-chip"
              style={{
                color: teamEmissiveCss(entry.team, colorblind),
                borderColor: teamCss(entry.team, colorblind),
              }}
            >
              <span className="score-chip__glyph">{TEAMS[entry.team].glyph}</span>
              <span>{entry.score}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top right: kill feed */}
      <div className="hud__corner hud__corner--tr">
        <div className="killfeed">
          {killFeed.map((entry) => (
            <div key={entry.id} className="killfeed__row">
              <span style={{ color: teamEmissiveCss(entry.killerTeam, colorblind) }}>
                {entry.killer}
              </span>
              <span className="killfeed__icon">{entry.headshot ? '◎' : '⌁'}</span>
              <span style={{ color: teamEmissiveCss(entry.victimTeam, colorblind) }}>
                {entry.victim}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top left: minimap and objective tracker */}
      <div className="hud__corner hud__corner--tl">
        <Minimap game={game} colorblind={colorblind} />
        <ObjectiveTracker objective={hud.objective} colorblind={colorblind} />
      </div>

      <Notifications notifications={notifications} colorblind={colorblind} />
      <NetOverlay game={game} mode={netOverlayMode} />

      {/* Bottom left: vitals */}
      <div className="hud__corner hud__corner--bl">
        <div className="vitals">
          <div className="vitals__label">Integrity</div>
          <div className="bar">
            <div
              className="bar__fill bar__fill--shield"
              style={{ transform: `scaleX(${hud.shield / COMBAT.maxShield})` }}
            />
          </div>
          <div className="bar">
            <div
              className="bar__fill bar__fill--health"
              style={{ transform: `scaleX(${hud.health / COMBAT.maxHealth})` }}
            />
          </div>
          <div className="vitals__numbers">
            <span>{Math.ceil(hud.health)}</span>
            <span className="vitals__shield-number">+{Math.ceil(hud.shield)}</span>
          </div>
        </div>
      </div>

      {/* Bottom right: charge cells and recharge meter */}
      <div className="hud__corner hud__corner--br">
        <div className="charge">
          <div className="charge__status">
            {hud.recharging
              ? 'Recharging'
              : hud.charge <= 2
                ? 'Low cell'
                : ''}
          </div>
          <div className="charge__cells">
            {Array.from({ length: hud.chargeMax }, (_, i) => {
              const filled = hud.recharging
                ? i < hud.rechargeProgress * hud.chargeMax
                : i < hud.charge;
              return (
                <div
                  key={i}
                  className={`charge__cell${filled ? ' charge__cell--lit' : ''}`}
                  style={{ ['--cell-color' as string]: teamColor }}
                />
              );
            })}
          </div>
          <div className="charge__meter">
            <div
              className="charge__meter-fill"
              style={{
                transform: `scaleX(${hud.recharging ? hud.rechargeProgress : hud.charge / hud.chargeMax})`,
                background: hud.recharging ? undefined : teamColor,
                boxShadow: `0 0 10px ${hud.recharging ? 'var(--photon-warn)' : teamColor}`,
              }}
            />
          </div>
          {graphics.showFps && (
            <div className="perf">
              {hud.fps.toFixed(0)} FPS · CPU {hud.cpuMs.toFixed(1)} · GPU{' '}
              {hud.gpuMs > 0 ? hud.gpuMs.toFixed(1) : '—'} · SIM {hud.simMs.toFixed(2)} ·{' '}
              {hud.drawCalls} DRAW
            </div>
          )}
        </div>
      </div>

      {!hud.alive && (
        <div className="death-overlay">
          <div className="death-overlay__title">TAGGED</div>
          <div className="death-overlay__timer">
            {hud.respawnIn > 0.1 ? `Respawn in ${hud.respawnIn.toFixed(1)}s` : 'Respawning…'}
          </div>
        </div>
      )}

      {subtitle && accessibility.subtitles && (
        <div className={`subtitle subtitle--${accessibility.subtitleSize}`}>{subtitle}</div>
      )}
    </div>
  );
}

/**
 * Objective tracker.
 *
 * Reads the central room's trigger volume. Contested is deliberately the loudest state — knowing
 * the middle is being fought over right now is the single most actionable thing the HUD can tell
 * you, and it is what turns the objective room from scenery into a decision.
 */
function ObjectiveTracker({
  objective,
  colorblind,
}: {
  objective: HudSnapshot['objective'];
  colorblind: boolean;
}) {
  const state = objective.contested
    ? 'CONTESTED'
    : objective.controllingTeam
      ? `${TEAMS[objective.controllingTeam].name.toUpperCase()} HOLDS`
      : 'NEUTRAL';

  const color = objective.contested
    ? 'var(--photon-warn)'
    : objective.controllingTeam
      ? teamEmissiveCss(objective.controllingTeam, colorblind)
      : 'var(--photon-dim)';

  return (
    <div className="objective" style={{ borderColor: color }}>
      <div className="objective__label">{objective.label}</div>
      <div className="objective__state" style={{ color }}>
        {state}
      </div>
      {objective.occupants > 0 && (
        <div className="objective__count">
          {objective.occupants} inside
          {!objective.contested && objective.heldSeconds > 1
            ? ` · ${objective.heldSeconds.toFixed(0)}s`
            : ''}
        </div>
      )}
    </div>
  );
}

/** Transient notification stack. Ages entries out on a light rAF tick while any are visible. */
function Notifications({
  notifications,
  colorblind,
}: {
  notifications: Array<{ id: number; text: string; tone: 'info' | 'good' | 'bad'; time: number }>;
  colorblind: boolean;
}) {
  const [, setFrame] = useState(0);
  void colorblind;

  useEffect(() => {
    if (notifications.length === 0) return;
    let raf = 0;
    const tick = () => {
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [notifications.length]);

  const now = performance.now() / 1000;
  const visible = notifications.filter((n) => now - n.time < NOTIFICATION_DURATION);
  if (visible.length === 0) return null;

  return (
    <div className="notifications">
      {visible.map((n) => {
        const age = now - n.time;
        return (
          <div
            key={n.id}
            className={`notification notification--${n.tone}`}
            style={{ opacity: Math.min(1, (NOTIFICATION_DURATION - age) / 0.6) }}
          >
            {n.text}
          </div>
        );
      })}
    </div>
  );
}

const NOTIFICATION_DURATION = 3.4;

/**
 * Directional damage indicators.
 *
 * Rotation is relative to the *current* camera yaw, recomputed each frame — an indicator that
 * stayed fixed to world space would point the wrong way the moment you turned to face the shooter.
 */
function DamageIndicators({
  indicators,
  game,
}: {
  indicators: Array<{ id: number; yaw: number; time: number }>;
  game: Game;
}) {
  const [, setFrame] = useState(0);

  useEffect(() => {
    if (indicators.length === 0) return;
    let raf = 0;
    const tick = () => {
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [indicators.length]);

  const now = performance.now() / 1000;
  const viewYaw = game.view.yaw;

  return (
    <>
      {indicators.map((indicator) => {
        const age = now - indicator.time;
        if (age > COMBAT.damageIndicatorDuration) return null;
        const relative = indicator.yaw - viewYaw;
        return (
          <div
            key={indicator.id}
            className="damage-indicator"
            style={{ transform: `rotate(${-relative}rad)` }}
          >
            <div
              className="damage-indicator__arc"
              style={{ opacity: 1 - age / COMBAT.damageIndicatorDuration }}
            />
          </div>
        );
      })}
    </>
  );
}
