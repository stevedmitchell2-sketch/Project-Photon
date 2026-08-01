import * as THREE from 'three';
import { TEAMS, type TeamId } from '@/config/teams';
import type { MatchState } from '@/gameplay/types';

/**
 * Content for the arena's LED infrastructure.
 *
 * The architectural rule this file exists to honour: **arena data declares intent, the renderer
 * decides expression.** An arena says "there is a scoreboard on this wall" by giving a `display`
 * prop the binding `scoreboard`; it does not say how a scoreboard looks, what it is made of, or
 * where the numbers come from. All of that lives here, so every future arena inherits the same
 * venue language for free and a change to how a scoreboard reads happens in one place.
 *
 * Each binding is a pure function from match state to a drawing. They are given a 2D context and a
 * palette and nothing else — no access to the scene, no side effects — which keeps them trivially
 * reorderable and testable, and makes it obvious that adding a board type costs nothing but a case.
 *
 * ## Why canvas textures
 *
 * A board is a rectangle of text that changes a few times a second at most. A canvas texture is one
 * draw call and one upload on change; text geometry would be hundreds of triangles re-tessellated
 * whenever a digit ticked. The existing clock panel already worked this way — this generalises it
 * rather than adding a second mechanism beside it.
 *
 * **Boards redraw only when their content string changes.** That is what keeps a wall of live
 * displays off the frame budget: a scoreboard showing 7–4 costs nothing at all until someone
 * scores.
 */

/** Board bindings an arena may request through a display prop's `text` field. */
export type BoardBinding =
  | 'clock'
  | 'scoreboard'
  | 'killfeed'
  | 'objective'
  | 'roundstatus';

export const BOARD_BINDINGS: readonly BoardBinding[] = [
  'clock',
  'scoreboard',
  'killfeed',
  'objective',
  'roundstatus',
];

export const isBoardBinding = (text: string | undefined): text is BoardBinding =>
  text !== undefined && (BOARD_BINDINGS as readonly string[]).includes(text);

export interface BoardPalette {
  /** The board's own accent, from the prop's colour. */
  accent: string;
  background: string;
  dim: string;
}

const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

export const teamCss = (team: TeamId): string => cssColor(TEAMS[team].emissive);

/**
 * The string that identifies a board's current content.
 *
 * Compared against the last drawn value to decide whether to redraw. It must capture everything
 * visible on the board — a signature that misses a field produces a board that silently stops
 * updating, which is far harder to notice than one that updates too often.
 */
export function boardSignature(binding: BoardBinding, state: MatchState, teams: TeamId[]): string {
  switch (binding) {
    case 'clock':
      return `c${Math.floor(Math.max(0, state.timeRemaining))}`;
    case 'scoreboard':
      return `s${teams.map((t) => state.scores[t] ?? 0).join('-')}`;
    case 'killfeed':
      return `k${state.killFeed.slice(-3).map((e) => e.id).join('-')}`;
    case 'objective':
      return `o${state.scores.red ?? 0}:${state.scores.blue ?? 0}`;
    case 'roundstatus':
      return `r${state.phase}${state.winner ?? ''}${Math.floor(Math.max(0, state.timeRemaining) / 10)}`;
    default:
      return '';
  }
}

/** Draws a board. Returns nothing; the caller flags the texture for upload. */
export function drawBoard(
  binding: BoardBinding,
  context: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
  state: MatchState,
  teams: TeamId[],
  palette: BoardPalette,
): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // A thin inset rule on every board, so they read as installed hardware of one family rather than
  // as text floating on a dark rectangle.
  context.strokeStyle = palette.dim;
  context.lineWidth = 3;
  context.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

  switch (binding) {
    case 'clock':
      drawClock(context, canvas, state, palette);
      break;
    case 'scoreboard':
      drawScoreboard(context, canvas, state, teams);
      break;
    case 'killfeed':
      drawKillFeed(context, canvas, state, palette);
      break;
    case 'objective':
      drawObjective(context, canvas, state, teams, palette);
      break;
    case 'roundstatus':
      drawRoundStatus(context, canvas, state, palette);
      break;
    default:
      break;
  }
}

const glow = (context: CanvasRenderingContext2D, color: string, blur = 20): void => {
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = blur;
};

function drawClock(
  context: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
  state: MatchState,
  palette: BoardPalette,
): void {
  const remaining = Math.max(0, Math.floor(state.timeRemaining));
  const label = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  // The last minute runs red. A clock that changes colour is readable from further away than one
  // that only changes digits.
  const urgent = remaining <= 60;
  glow(context, urgent ? '#ff2d55' : palette.accent, urgent ? 34 : 20);

  context.font = 'bold 84px Rajdhani, Segoe UI, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 6);

  context.shadowBlur = 0;
  context.fillStyle = palette.dim;
  context.font = 'bold 20px Rajdhani, Segoe UI, sans-serif';
  context.fillText('MATCH TIME', canvas.width / 2, 26);
}

function drawScoreboard(
  context: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
  state: MatchState,
  teams: TeamId[],
): void {
  const shown = teams.slice(0, 2);
  const columnWidth = canvas.width / Math.max(1, shown.length);

  shown.forEach((team, i) => {
    const centre = columnWidth * (i + 0.5);
    const color = teamCss(team);

    context.shadowBlur = 0;
    context.fillStyle = color;
    context.globalAlpha = 0.14;
    context.fillRect(columnWidth * i + 8, 8, columnWidth - 16, canvas.height - 16);
    context.globalAlpha = 1;

    context.textAlign = 'center';
    context.textBaseline = 'middle';

    context.fillStyle = color;
    context.font = 'bold 22px Rajdhani, Segoe UI, sans-serif';
    context.fillText(TEAMS[team].name.toUpperCase(), centre, 28);

    // White numerals over a team-tinted panel, not team-coloured numerals.
    //
    // The first pass drew both in the team colour and the score was barely readable from across the
    // room: a red digit on a red panel has almost no luminance contrast, however much it glows.
    // Real scoreboards solve this the same way — the colour identifies the side, the number stays
    // white — and it keeps the digits legible for a colourblind player, who gets the value from
    // luminance rather than hue.
    context.shadowColor = color;
    context.shadowBlur = 30;
    context.fillStyle = '#ffffff';
    context.font = 'bold 76px Rajdhani, Segoe UI, sans-serif';
    context.fillText(String(state.scores[team] ?? 0), centre, canvas.height / 2 + 16);
    context.shadowBlur = 0;
  });

  // Divider, so two columns read as one scoreboard rather than two signs.
  context.strokeStyle = 'rgba(255,255,255,0.18)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(canvas.width / 2, 14);
  context.lineTo(canvas.width / 2, canvas.height - 14);
  context.stroke();
}

function drawKillFeed(
  context: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
  state: MatchState,
  palette: BoardPalette,
): void {
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = palette.dim;
  context.font = 'bold 18px Rajdhani, Segoe UI, sans-serif';
  context.fillText('ELIMINATIONS', 20, 22);

  const recent = state.killFeed.slice(-3).reverse();
  if (recent.length === 0) {
    context.fillStyle = palette.dim;
    context.font = 'bold 28px Rajdhani, Segoe UI, sans-serif';
    context.fillText('STANDBY', 20, canvas.height / 2 + 10);
    return;
  }

  recent.forEach((entry, i) => {
    const y = 54 + i * 30;
    context.font = 'bold 26px Rajdhani, Segoe UI, sans-serif';

    context.fillStyle = teamCss(entry.killerTeam);
    context.fillText(entry.killer, 20, y);
    const killerWidth = context.measureText(entry.killer).width;

    context.fillStyle = palette.dim;
    context.fillText('>', 30 + killerWidth, y);

    context.fillStyle = teamCss(entry.victimTeam);
    context.fillText(entry.victim, 54 + killerWidth, y);
  });
}

function drawObjective(
  context: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
  state: MatchState,
  teams: TeamId[],
  palette: BoardPalette,
): void {
  const shown = teams.slice(0, 2);
  const totals = shown.map((t) => state.scores[t] ?? 0);
  const sum = Math.max(1, totals[0] + (totals[1] ?? 0));

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = palette.dim;
  context.font = 'bold 20px Rajdhani, Segoe UI, sans-serif';
  context.fillText('CONTROL', canvas.width / 2, 26);

  // A single proportional bar. Which side is winning is legible at a glance and at any distance,
  // which a pair of numbers is not.
  const barY = canvas.height / 2 + 4;
  const barHeight = 34;
  const margin = 24;
  const width = canvas.width - margin * 2;
  let x = margin;

  shown.forEach((team, i) => {
    const share = (totals[i] ?? 0) / sum;
    const w = width * share;
    context.fillStyle = teamCss(team);
    context.shadowColor = teamCss(team);
    context.shadowBlur = 18;
    context.fillRect(x, barY - barHeight / 2, w, barHeight);
    x += w;
  });
  context.shadowBlur = 0;

  context.strokeStyle = 'rgba(255,255,255,0.22)';
  context.lineWidth = 2;
  context.strokeRect(margin, barY - barHeight / 2, width, barHeight);
}

function drawRoundStatus(
  context: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
  state: MatchState,
  palette: BoardPalette,
): void {
  const remaining = Math.max(0, state.timeRemaining);
  let label = 'MATCH LIVE';
  let color = palette.accent;

  if (state.phase === 'ended') {
    label = state.winner ? `${state.winner.toUpperCase()} WINS` : 'DRAW';
    color = state.winner ? teamCss(state.winner as TeamId) : palette.accent;
  } else if (remaining <= 10) {
    label = 'FINAL SECONDS';
    color = '#ff2d55';
  } else if (remaining <= 60) {
    label = 'FINAL MINUTE';
    color = '#ffd84d';
  }

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  glow(context, color, 24);
  context.font = 'bold 46px Rajdhani, Segoe UI, sans-serif';
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 4);
  context.shadowBlur = 0;
}

/** Shared canvas + texture for one board. */
export function createBoardTexture(width = 512, height = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return { canvas, context, texture };
}
