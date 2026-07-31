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
  const shadow = settings.outline ? '0 0 3px #000, 0 0 1px #000' : 'none';

  const markerAge = hitMarker ? now - hitMarker.time : Infinity;
  const markerDuration = hitMarker?.killed ? COMBAT.killMarkerDuration : COMBAT.hitMarkerDuration;
  const showMarker = settings.showHitMarker && markerAge < markerDuration;

  return (
    <>
      <div className="crosshair" style={{ color, filter: `drop-shadow(${shadow})` }}>
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
