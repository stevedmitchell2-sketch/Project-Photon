import { useEffect, useRef, useState } from 'react';
import type { Game } from '@/engine/Game';
import type { NetClientStats } from '@/net/NetClient';

/**
 * Developer networking overlay.
 *
 * Toggled with F3 (or `~` for the compact strip). Reads directly from the live NetClient each
 * frame rather than going through the UI store, because the whole point is to observe the network
 * without the observation itself being throttled by the HUD's 20 Hz snapshot cadence.
 *
 * The latency graph is drawn to a canvas: 240 samples of history at one pixel each is far cheaper
 * than 240 React nodes, and a spike is much easier to see as a shape than as a number.
 */

const HISTORY = 240;

export function NetOverlay({ game, mode }: { game: Game; mode: 'off' | 'compact' | 'full' }) {
  const [stats, setStats] = useState<NetClientStats | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rttHistory = useRef<number[]>([]);
  const lossHistory = useRef<number[]>([]);
  const correctionHistory = useRef<number[]>([]);

  useEffect(() => {
    if (mode === 'off') return;
    let raf = 0;
    let last = 0;

    const tick = (time: number) => {
      raf = requestAnimationFrame(tick);
      if (time - last < 100) return; // 10 Hz is plenty for numbers a human reads.
      last = time;

      const client = game.netClient;
      if (!client) return;
      const snapshot = { ...client.stats };
      setStats(snapshot);

      rttHistory.current.push(snapshot.quality.rttMs);
      lossHistory.current.push(snapshot.quality.packetLossPercent);
      correctionHistory.current.push(snapshot.corrections);
      if (rttHistory.current.length > HISTORY) rttHistory.current.shift();
      if (lossHistory.current.length > HISTORY) lossHistory.current.shift();
      if (correctionHistory.current.length > HISTORY) correctionHistory.current.shift();

      drawGraph(canvasRef.current, rttHistory.current, lossHistory.current, correctionHistory.current);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game, mode]);

  if (mode === 'off') return null;

  if (!stats) {
    return (
      <div className="netoverlay netoverlay--compact">
        <div className="netoverlay__row">
          <span>NET</span>
          <span style={{ color: 'var(--photon-dim)' }}>offline</span>
        </div>
      </div>
    );
  }

  const q = stats.quality;
  const ratingColour = {
    excellent: '#2dff87',
    good: '#8fff2d',
    fair: 'var(--photon-warn)',
    poor: '#ff8c2d',
    disconnected: 'var(--photon-danger)',
  }[q.rating];

  if (mode === 'compact') {
    return (
      <div className="netoverlay netoverlay--compact">
        <div className="netoverlay__row">
          <span>PING</span>
          <span style={{ color: ratingColour }}>{q.rttMs} ms</span>
        </div>
        <div className="netoverlay__row">
          <span>LOSS</span>
          <span style={{ color: q.packetLossPercent > 2 ? 'var(--photon-danger)' : undefined }}>
            {q.packetLossPercent}%
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="netoverlay">
      <div className="netoverlay__title">
        NETWORK <span style={{ color: ratingColour }}>{q.rating.toUpperCase()}</span>
      </div>

      <canvas ref={canvasRef} width={HISTORY} height={54} className="netoverlay__graph" />
      <div className="netoverlay__legend">
        <span style={{ color: '#4de3ff' }}>ping</span>
        <span style={{ color: '#ff4d6d' }}>loss</span>
        <span style={{ color: '#ffd84d' }}>corrections</span>
      </div>

      <Section title="Connection">
        <Row label="Ping" value={`${q.rttMs} ms`} colour={ratingColour} />
        <Row label="Jitter" value={`${q.jitterMs} ms`} warn={q.jitterMs > 30} />
        <Row label="Packet loss" value={`${q.packetLossPercent}%`} warn={q.packetLossPercent > 2} />
        <Row label="Ticks ahead" value={String(q.predictedTicksAhead)} />
      </Section>

      <Section title="Replication">
        <Row label="Server tick" value={String(stats.serverTick)} />
        <Row label="Client tick" value={String(stats.clientTick)} />
        <Row label="Snapshot delay" value={`${stats.snapshotDelayMs} ms`} warn={stats.snapshotDelayMs > 120} />
        <Row label="Interp buffer" value={`${stats.interpolationDelayMs} ms`} />
        <Row label="Snapshots" value={`${stats.snapshotsReceived} ok / ${stats.snapshotsDropped} lost`} />
      </Section>

      <Section title="Prediction">
        <Row
          label="Corrections/s"
          value={String(stats.corrections)}
          warn={stats.corrections > 3}
        />
        <Row
          label="Last error"
          value={`${stats.lastCorrectionMetres.toFixed(3)} m`}
          warn={stats.lastCorrectionMetres > 0.5}
        />
      </Section>

      <Section title="Bandwidth">
        <Row label="Down" value={`${(stats.downstreamBps / 1024).toFixed(1)} KB/s`} />
        <Row label="Up" value={`${(stats.upstreamBps / 1024).toFixed(1)} KB/s`} />
        <Row label="Total in" value={`${(stats.bytesReceived / 1024).toFixed(0)} KB`} />
      </Section>

      {stats.corrections > 5 && (
        <div className="netoverlay__warning">
          High correction rate — client prediction is disagreeing with the server. Check for a
          non-deterministic path in movement.
        </div>
      )}
      {!stats.connected && <div className="netoverlay__warning">Disconnected from server.</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="netoverlay__section">
      <div className="netoverlay__section-title">{title}</div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  colour,
  warn,
}: {
  label: string;
  value: string;
  colour?: string;
  warn?: boolean;
}) {
  return (
    <div className="netoverlay__row">
      <span>{label}</span>
      <span style={{ color: warn ? 'var(--photon-danger)' : colour }}>{value}</span>
    </div>
  );
}

/** Three overlaid series on one canvas, each normalised to its own sensible ceiling. */
function drawGraph(
  canvas: HTMLCanvasElement | null,
  rtt: number[],
  loss: number[],
  corrections: number[],
): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(4, 10, 18, 0.6)';
  ctx.fillRect(0, 0, width, height);

  // Reference line at 100 ms, the threshold where latency starts being felt.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(0, height - (100 / 300) * height);
  ctx.lineTo(width, height - (100 / 300) * height);
  ctx.stroke();

  const series: Array<{ data: number[]; max: number; colour: string }> = [
    { data: rtt, max: 300, colour: '#4de3ff' },
    { data: loss, max: 10, colour: '#ff4d6d' },
    { data: corrections, max: 10, colour: '#ffd84d' },
  ];

  for (const { data, max, colour } of series) {
    if (data.length < 2) continue;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const offset = width - data.length;
    data.forEach((value, i) => {
      const y = height - Math.min(1, value / max) * height;
      if (i === 0) ctx.moveTo(offset + i, y);
      else ctx.lineTo(offset + i, y);
    });
    ctx.stroke();
  }
}
