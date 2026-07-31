import { useEffect, useRef } from 'react';
import { teamCss } from '@/config/teams';
import type { Game } from '@/engine/Game';

/**
 * Minimap.
 *
 * Drawn to a 2D canvas from arena brush data plus live actor positions, on its own ~20 Hz timer.
 * Keeping it off the React render path and off the WebGL context means it costs a fraction of a
 * millisecond and never triggers a scene-graph traversal.
 */
export function Minimap({ game, colorblind }: { game: Game; colorblind: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const arena = game.arena.definition;
    const [minX, minZ, maxX, maxZ] = arena.bounds;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const size = 172;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const toX = (x: number) => ((x - minX) / width) * size;
    const toY = (z: number) => ((z - minZ) / depth) * size;

    // Static layer: walls and barriers rasterized once into an offscreen canvas.
    const staticLayer = document.createElement('canvas');
    staticLayer.width = size;
    staticLayer.height = size;
    const sctx = staticLayer.getContext('2d')!;
    sctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (const brush of arena.brushes) {
      if (brush.noCollide) continue;
      if (brush.kind === 'floor' || brush.kind === 'led' || brush.kind === 'trim') continue;
      const w = (brush.s[0] / width) * size;
      const h = (brush.s[2] / depth) * size;
      sctx.fillStyle =
        brush.kind === 'wall' || brush.kind === 'pillar'
          ? 'rgba(140,190,225,0.34)'
          : brush.kind === 'catwalk'
            ? 'rgba(77,227,255,0.12)'
            : 'rgba(120,160,195,0.2)';
      sctx.save();
      sctx.translate(toX(brush.p[0]), toY(brush.p[2]));
      if (brush.rot) sctx.rotate((brush.rot * Math.PI) / 180);
      sctx.fillRect(-w / 2, -h / 2, w, h);
      sctx.restore();
    }

    let raf = 0;
    let last = 0;

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (time - last < 50) return; // ~20 Hz is plenty for a minimap.
      last = time;

      const local = game.localActor;
      if (!local) return;

      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(staticLayer, 0, 0);

      // Actors: teammates always visible, enemies only when they have line of sight to you.
      for (const actor of game.match.state.actors.values()) {
        if (!actor.alive) continue;
        const isLocal = actor.id === local.id;
        const friendly = actor.team === local.team && !game.match.mode.freeForAll;
        if (!isLocal && !friendly) {
          const visible = game.physics.hasLineOfSight(
            { x: local.position.x, y: local.position.y + 1.6, z: local.position.z },
            { x: actor.position.x, y: actor.position.y + 1.5, z: actor.position.z },
          );
          if (!visible) continue;
        }

        const x = toX(actor.position.x);
        const y = toY(actor.position.z);
        // Actors on a different floor are drawn hollow so verticality is legible.
        const sameFloor = Math.abs(actor.position.y - local.position.y) < 2.5;
        ctx.fillStyle = teamCss(actor.team, colorblind);
        ctx.strokeStyle = teamCss(actor.team, colorblind);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, isLocal ? 3.6 : 2.8, 0, Math.PI * 2);
        if (sameFloor || isLocal) ctx.fill();
        else ctx.stroke();
      }

      // Local heading cone.
      const lx = toX(local.position.x);
      const ly = toY(local.position.z);
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(-local.yaw);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(5, 3);
      ctx.lineTo(-5, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game, colorblind]);

  return (
    <div className="minimap">
      <canvas ref={canvasRef} className="minimap__canvas" style={{ width: 172, height: 172 }} />
    </div>
  );
}
