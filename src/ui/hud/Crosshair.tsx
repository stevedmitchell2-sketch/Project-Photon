import { useEffect, useState } from 'react';
import { COMBAT } from '@/config/combat';
import type { CrosshairSettings } from '@/state/settingsStore';
import { useUi } from '@/state/uiStore';

/**
 * Crosshair and hit marker.
 *
 * The gap expands with the weapon's live spread when dynamic mode is on, so the reticle is an
 * honest readout of accuracy rather than decoration — that feedback is what teaches players to
 * stop moving before they shoot.
 */
export function Crosshair({ settings }: { settings: CrosshairSettings }) {
  const spread = useUi((s) => s.hud.spread);
  const adsBlend = useUi((s) => s.hud.adsBlend);
  const alive = useUi((s) => s.hud.alive);
  const hitMarker = useUi((s) => s.hitMarker);
  const charge = useUi((s) => s.hud.charge);
  const chargeMax = useUi((s) => s.hud.chargeMax);
  const recharging = useUi((s) => s.hud.recharging);
  const rechargeProgress = useUi((s) => s.hud.rechargeProgress);
  const team = useUi((s) => s.hud.team);
  const [now, setNow] = useState(() => performance.now() / 1000);

  // Hit markers are short-lived; a light rAF tick is cheaper than storing an expiry timer per hit.
  useEffect(() => {
    if (!hitMarker) return;
    let raf = 0;
    const tick = () => {
      setNow(performance.now() / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hitMarker]);

  if (!alive) return null;

  const dynamicGap = settings.dynamic ? settings.gap + spread * 4.2 : settings.gap;
  const gap = dynamicGap * (1 - adsBlend * 0.55);
  const length = settings.size * (1 - adsBlend * 0.35);
  const thickness = settings.thickness;
  const color = settings.color;
  // Two shadows, not one: a tight dark rim for edge definition against a pale surface, and a wider
  // soft one so the reticle still separates from a bright bloomed highlight. The Sprint 7 playtest
  // found the single 3 px shadow left the crosshair effectively invisible against a lit wall.
  const shadow = settings.outline
    ? 'drop-shadow(0 0 1px #000) drop-shadow(0 0 4px rgba(0,0,0,0.85))'
    : 'none';

  const markerAge = hitMarker ? now - hitMarker.time : Infinity;
  const markerDuration = hitMarker?.killed ? COMBAT.killMarkerDuration : COMBAT.hitMarkerDuration;
  const showMarker = settings.showHitMarker && markerAge < markerDuration;

  return (
    <>
      <RechargeRing
        charge={charge}
        chargeMax={chargeMax}
        recharging={recharging}
        rechargeProgress={rechargeProgress}
        team={team}
        radius={gap + length + 9}
      />

      <div className="crosshair" style={{ color, filter: shadow }}>
        {settings.style === 'dot' && (
          <div
            className="crosshair__line"
            style={{
              width: thickness * 1.6,
              height: thickness * 1.6,
              left: -thickness * 0.8,
              top: -thickness * 0.8,
              borderRadius: '50%',
            }}
          />
        )}

        {settings.style === 'circle' && (
          <div
            style={{
              position: 'absolute',
              width: gap * 2 + length,
              height: gap * 2 + length,
              left: -(gap * 2 + length) / 2,
              top: -(gap * 2 + length) / 2,
              border: `${thickness}px solid currentColor`,
              borderRadius: '50%',
            }}
          />
        )}

        {(settings.style === 'cross' || settings.style === 'chevron') && (
          <>
            <div
              className="crosshair__line"
              style={{ width: thickness, height: length, left: -thickness / 2, top: -gap - length }}
            />
            <div
              className="crosshair__line"
              style={{ width: thickness, height: length, left: -thickness / 2, top: gap }}
            />
            <div
              className="crosshair__line"
              style={{ width: length, height: thickness, left: -gap - length, top: -thickness / 2 }}
            />
            <div
              className="crosshair__line"
              style={{ width: length, height: thickness, left: gap, top: -thickness / 2 }}
            />
          </>
        )}

        {settings.style === 'chevron' && (
          <div
            className="crosshair__line"
            style={{
              width: thickness,
              height: length * 0.6,
              left: -thickness / 2,
              top: gap + length + 3,
              opacity: 0.6,
            }}
          />
        )}

        {/* Centre pip. The four arms move apart as spread grows, which is the honest readout, but
            it leaves nothing marking the exact point of aim at full spread. The pip is what the eye
            actually aligns on at range. */}
        {settings.style !== 'dot' && (
          <div
            className="crosshair__line"
            style={{
              width: thickness,
              height: thickness,
              left: -thickness / 2,
              top: -thickness / 2,
              borderRadius: '50%',
              opacity: 0.85,
            }}
          />
        )}
      </div>

      {showMarker && (
        <div
          className={`hitmarker${hitMarker?.killed ? ' hitmarker--kill' : ''}`}
          style={{ opacity: 1 - markerAge / markerDuration }}
        >
          {[
            { w: 2, h: 11, l: -1, t: -17 },
            { w: 2, h: 11, l: -1, t: 6 },
            { w: 11, h: 2, l: -17, t: -1 },
            { w: 11, h: 2, l: 6, t: -1 },
          ].map((line, i) => (
            <div
              key={i}
              className="hitmarker__line"
              style={{ width: line.w, height: line.h, left: line.l, top: line.t }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Charge state, drawn as a ring around the reticle.
 *
 * The cell counter lives in the corner of the screen, which is the wrong place for it: it is the
 * single piece of information a player needs *while aiming*, and looking away to read it costs the
 * shot. The ring puts it in peripheral vision at the point of aim, where it can be read without
 * moving the eye.
 *
 * Two states, deliberately different in shape rather than only in colour:
 *
 *   - **charged** — one tick mark per remaining shot, so the count is countable at a glance;
 *   - **recharging** — a single sweeping arc, unmistakably different, filling as the cell cycles.
 *
 * Colour follows the team accent, so it also reinforces which side the player is on. Colour is
 * never the only carrier of meaning here: shape distinguishes the two states, and the tick count
 * distinguishes the charge levels.
 */
function RechargeRing({
  charge,
  chargeMax,
  recharging,
  rechargeProgress,
  team,
  radius,
}: {
  charge: number;
  chargeMax: number;
  recharging: boolean;
  rechargeProgress: number;
  team: string;
  radius: number;
}) {
  if (chargeMax <= 0) return null;

  const size = radius * 2 + 8;
  const centre = size / 2;
  const circumference = 2 * Math.PI * radius;
  const accent = `var(--team-${team}, #46e8ff)`;

  return (
    <svg
      className="crosshair-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      {recharging ? (
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={accent}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={`${circumference * rechargeProgress} ${circumference}`}
          // Start the sweep at twelve o'clock rather than three, which is where the eye expects a
          // progress arc to begin.
          transform={`rotate(-90 ${centre} ${centre})`}
          opacity={0.9}
        />
      ) : (
        Array.from({ length: chargeMax }, (_, i) => {
          const spent = i >= charge;
          // Ticks occupy the lower arc, leaving the top clear so the ring never sits over whatever
          // the player is aiming at.
          const spanDegrees = 150;
          const step = spanDegrees / Math.max(1, chargeMax - 1);
          const angle = (90 + (i - (chargeMax - 1) / 2) * step) * (Math.PI / 180);
          const inner = radius - 3;
          const outer = radius + 3;
          return (
            <line
              key={i}
              x1={centre + Math.cos(angle) * inner}
              y1={centre + Math.sin(angle) * inner}
              x2={centre + Math.cos(angle) * outer}
              y2={centre + Math.sin(angle) * outer}
              stroke={spent ? 'rgba(255,255,255,0.22)' : accent}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          );
        })
      )}
    </svg>
  );
}
