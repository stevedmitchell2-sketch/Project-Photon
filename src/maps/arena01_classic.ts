import type { TeamId } from '@/config/teams';
import type { ArenaDefinition, Brush, PropSpec, SpawnPoint, SurfaceKind } from './MapTypes';

/**
 * ARENA 01 — "Classic"
 *
 * The reference laser-tag arena: two floors, a perimeter catwalk ring reached by four ramps,
 * a central objective room whose roof is the high ground, and a maze of barriers on the deck.
 *
 * The ground-floor maze is authored once for a single quadrant and rotated four times. That is
 * not a shortcut — rotational symmetry is what guarantees the four corner spawns are balanced,
 * and it means a tuning change to one quadrant applies to all of them.
 */

const HALF = 30; // Arena is 60x60 m.
const UPPER = 5.0; // Height of the catwalk deck.
const SLAB = 0.3; // Catwalk slab thickness.
const WALL_H = 9;

/** Rotates a quadrant-local brush by k * 90 degrees about the arena centre. */
function rotateBrush(b: Brush, k: number): Brush {
  // y and sy are unaffected by a rotation about the Y axis.
  const [, y, ] = b.p;
  let [x, , z] = b.p;
  const sy = b.s[1];
  let [sx, , sz] = b.s;
  for (let i = 0; i < k; i++) {
    const nx = z;
    const nz = -x;
    x = nx;
    z = nz;
    const t = sx;
    sx = sz;
    sz = t;
  }
  return { ...b, p: [x, y, z], s: [sx, sy, sz], rot: (b.rot ?? 0) + k * 90 };
}

/**
 * Splits a barrier spanning [-span, +span] into segments, leaving openings at the given centres.
 *
 * Railings and roof lips are the right call for readability and for stopping accidental falls, but
 * an unbroken one severs the level: it sits directly over the point where a ramp or bridge meets
 * the deck, drops headroom below crouch height, and the navigation bake correctly refuses to link
 * across it. Every place traffic crosses a barrier gets an opening.
 */
function segmentsAlong(
  span: number,
  gaps: Array<{ at: number; halfWidth: number }>,
): Array<{ centre: number; length: number }> {
  const sorted = [...gaps].sort((a, b) => a.at - b.at);
  const segments: Array<{ centre: number; length: number }> = [];
  let cursor = -span;
  for (const gap of sorted) {
    const start = gap.at - gap.halfWidth;
    if (start > cursor) segments.push({ centre: (cursor + start) / 2, length: start - cursor });
    cursor = Math.max(cursor, gap.at + gap.halfWidth);
  }
  if (span > cursor) segments.push({ centre: (cursor + span) / 2, length: span - cursor });
  return segments;
}

/** Where ramps and bridges meet the perimeter ring, per side. */
const RAIL_GAP_HALF = 3.4;

/**
 * Emits a flight of steps from `from` up to `to`.
 *
 * Stairs play differently from ramps: the tread depth sets your approach speed, and the risers give
 * cover to anyone below, so an arena wants both. Rise per step stays under the character
 * controller's autostep height so climbing them needs no jump and no special-casing — the navigation
 * bake then links them automatically like any other walkable surface.
 */
function buildStairs(
  from: [number, number, number],
  to: [number, number, number],
  width: number,
  kind: SurfaceKind = 'catwalk',
): Brush[] {
  const rise = to[1] - from[1];
  const runX = to[0] - from[0];
  const runZ = to[2] - from[2];
  const runLength = Math.hypot(runX, runZ);

  // Keep each riser comfortably below MOVEMENT.stepHeight (0.42 m).
  const steps = Math.max(2, Math.ceil(rise / 0.34));
  const stepRise = rise / steps;
  const tread = runLength / steps;
  const yaw = (Math.atan2(runX, runZ) * 180) / Math.PI;

  const brushes: Brush[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const topY = from[1] + stepRise * (i + 1);
    brushes.push({
      // Each step is a solid block down to the floor beneath, so there is no gap to fall through.
      p: [from[0] + runX * t, topY - stepRise / 2 - 0.15, from[2] + runZ * t],
      s: [width, stepRise + 0.3, tread],
      kind,
      rot: yaw,
    });
  }
  return brushes;
}

/** One quadrant of the ground-floor maze, authored in the +X / +Z corner. */
const QUADRANT_MAZE: Brush[] = [
  { p: [7, 1.2, 10.5], s: [13, 2.4, 0.7], kind: 'barrier' },
  { p: [13.2, 1.2, 19], s: [0.7, 2.4, 16], kind: 'barrier' },
  { p: [22.5, 1.2, 8.5], s: [0.7, 2.4, 13], kind: 'barrier' },
  { p: [19, 1.2, 16.5], s: [10, 2.4, 0.7], kind: 'barrier' },
  { p: [7.5, 0.75, 23.5], s: [3.4, 1.5, 3.4], kind: 'barrier' },
  // Kept clear of the corner spawn cluster at (25, 25) and its two 3.5 m offsets.
  { p: [21.5, 0.9, 17], s: [3, 1.8, 3], kind: 'barrier' },
  { p: [16.5, 2.5, 25.5], s: [1.5, 5, 1.5], kind: 'pillar' },
  { p: [4.5, 2.5, 16], s: [1.5, 5, 1.5], kind: 'pillar' },
  // Waist-high cover that lets you slide under fire lines without fully breaking sight.
  { p: [11, 0.55, 5.5], s: [5, 1.1, 0.7], kind: 'barrier' },
  { p: [26, 0.55, 13], s: [0.7, 1.1, 6], kind: 'barrier' },
];

/** Neon trim strips — decorative, emissive, no collision. Rotated with the maze. */
const QUADRANT_TRIM: Brush[] = [
  { p: [7, 2.45, 10.5], s: [13, 0.12, 0.8], kind: 'trim', glow: 3.2, noCollide: true, noNav: true },
  { p: [13.2, 2.45, 19], s: [0.8, 0.12, 16], kind: 'trim', glow: 3.2, noCollide: true, noNav: true },
  { p: [16.5, 5.05, 25.5], s: [1.7, 0.14, 1.7], kind: 'trim', glow: 4, noCollide: true, noNav: true },
];

function buildBrushes(): Brush[] {
  const brushes: Brush[] = [];

  // --- Shell -------------------------------------------------------------
  brushes.push({ p: [0, -0.5, 0], s: [HALF * 2, 1, HALF * 2], kind: 'floor' });
  brushes.push({ p: [0, WALL_H / 2, -HALF], s: [HALF * 2, WALL_H, 1], kind: 'wall' });
  brushes.push({ p: [0, WALL_H / 2, HALF], s: [HALF * 2, WALL_H, 1], kind: 'wall' });
  brushes.push({ p: [-HALF, WALL_H / 2, 0], s: [1, WALL_H, HALF * 2], kind: 'wall' });
  brushes.push({ p: [HALF, WALL_H / 2, 0], s: [1, WALL_H, HALF * 2], kind: 'wall' });
  // Ceiling: keeps bolts in and gives the fog volume a top. It must not cast shadows — a slab
  // spanning the entire arena would otherwise occlude the key light and put every surface below it
  // in full shadow, which is most of why the arena used to render black.
  brushes.push({
    p: [0, WALL_H, 0],
    s: [HALF * 2, 0.6, HALF * 2],
    kind: 'wall',
    noNav: true,
    noShadow: true,
  });

  // --- Upper deck: perimeter catwalk ring ---------------------------------
  const ringY = UPPER - SLAB / 2;
  const ringW = 5;
  const ringOffset = HALF - ringW / 2 - 0.5;
  brushes.push({ p: [0, ringY, -ringOffset], s: [HALF * 2 - 1, SLAB, ringW], kind: 'catwalk' });
  brushes.push({ p: [0, ringY, ringOffset], s: [HALF * 2 - 1, SLAB, ringW], kind: 'catwalk' });
  brushes.push({ p: [-ringOffset, ringY, 0], s: [ringW, SLAB, HALF * 2 - 1], kind: 'catwalk' });
  brushes.push({ p: [ringOffset, ringY, 0], s: [ringW, SLAB, HALF * 2 - 1], kind: 'catwalk' });

  // Inner railing on the ring — chest height, so you can shoot over but not walk off blindly.
  // Each side is broken where its bridge (at 0) and its ramp arrive.
  const railY = UPPER + 0.55;
  const railInner = HALF - ringW - 0.5;
  const railSpan = HALF - 0.5;
  // `openings` lists every point along the side where traffic crosses: the bridge at 0, the ramp,
  // and (north/south only) the staircase. Anything arriving at an unlisted point gets sealed out.
  const railSides: Array<{ axis: 'x' | 'z'; offset: number; openings: number[] }> = [
    { axis: 'x', offset: -railInner, openings: [0, 18, -9] }, // North: bridge, ramp, stairs.
    { axis: 'x', offset: railInner, openings: [0, -18, 9] }, // South: bridge, ramp, stairs.
    { axis: 'z', offset: -railInner, openings: [0, -18] }, // West: bridge, ramp.
    { axis: 'z', offset: railInner, openings: [0, 18] }, // East: bridge, ramp.
  ];
  for (const side of railSides) {
    const gaps = side.openings.map((at) => ({ at, halfWidth: RAIL_GAP_HALF }));
    for (const segment of segmentsAlong(railSpan, gaps)) {
      if (side.axis === 'x') {
        brushes.push({
          p: [segment.centre, railY, side.offset],
          s: [segment.length, 1.1, 0.25],
          kind: 'glass',
          noNav: true,
        });
      } else {
        brushes.push({
          p: [side.offset, railY, segment.centre],
          s: [0.25, 1.1, segment.length],
          kind: 'glass',
          noNav: true,
        });
      }
    }
  }

  // --- Central objective room --------------------------------------------
  const roomHalf = 8;
  const roomH = UPPER;
  const doorHalf = 2;
  const segLen = roomHalf - doorHalf;
  const segCentre = doorHalf + segLen / 2;
  for (const sign of [-1, 1]) {
    for (const side of [-1, 1]) {
      // Walls on the Z faces.
      brushes.push({
        p: [side * segCentre, roomH / 2, sign * roomHalf],
        s: [segLen, roomH, 0.8],
        kind: 'wall',
      });
      // Walls on the X faces.
      brushes.push({
        p: [sign * roomHalf, roomH / 2, side * segCentre],
        s: [0.8, roomH, segLen],
        kind: 'wall',
      });
    }
  }
  // Roof of the objective room is the arena's high ground.
  brushes.push({ p: [0, UPPER - 0.2, 0], s: [roomHalf * 2 + 1.2, 0.4, roomHalf * 2 + 1.2], kind: 'catwalk' });
  // Roof lip so you have cover when holding the top, broken where each bridge lands.
  const lipOffset = roomHalf + 0.4;
  const lipSpan = roomHalf + 0.6;
  const lipGaps = [{ at: 0, halfWidth: RAIL_GAP_HALF }];
  for (const sign of [-1, 1]) {
    for (const segment of segmentsAlong(lipSpan, lipGaps)) {
      brushes.push({
        p: [segment.centre, UPPER + 0.4, sign * lipOffset],
        s: [segment.length, 0.8, 0.3],
        kind: 'glass',
        noNav: true,
      });
      brushes.push({
        p: [sign * lipOffset, UPPER + 0.4, segment.centre],
        s: [0.3, 0.8, segment.length],
        kind: 'glass',
        noNav: true,
      });
    }
  }
  // Objective plinth inside the room.
  brushes.push({ p: [0, 0.4, 0], s: [4, 0.8, 4], kind: 'barrier', glow: 0.6 });
  brushes.push({ p: [0, 0.85, 0], s: [4.2, 0.1, 4.2], kind: 'trim', glow: 5, noCollide: true, noNav: true });
  // Interior cover pillars so the room is not a pure death box.
  for (const [px, pz] of [
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5],
  ]) {
    brushes.push({ p: [px, roomH / 2, pz], s: [1.2, roomH, 1.2], kind: 'pillar' });
  }

  // --- Bridges from the ring to the room roof -----------------------------
  const bridgeSpan = (HALF - ringW - 0.5 - roomHalf) / 2 + roomHalf;
  const bridgeLen = HALF - ringW - 0.5 - roomHalf;
  const bridgeMid = roomHalf + bridgeLen / 2;
  void bridgeSpan;
  brushes.push({ p: [0, ringY, -bridgeMid], s: [4.5, SLAB, bridgeLen + 1], kind: 'catwalk' });
  brushes.push({ p: [0, ringY, bridgeMid], s: [4.5, SLAB, bridgeLen + 1], kind: 'catwalk' });
  brushes.push({ p: [-bridgeMid, ringY, 0], s: [bridgeLen + 1, SLAB, 4.5], kind: 'catwalk' });
  brushes.push({ p: [bridgeMid, ringY, 0], s: [bridgeLen + 1, SLAB, 4.5], kind: 'catwalk' });

  // --- Ramps: ground deck up to the ring ----------------------------------
  // Pitch chosen so the run clears the maze and the top lands flush with the catwalk.
  const rampPitch = 19.5;
  const rampLen = 16.2;
  const rampY = UPPER / 2 - 0.1;
  const ramps: Array<{ p: [number, number, number]; rot: number }> = [
    { p: [-19, rampY, -18], rot: 90 },
    { p: [19, rampY, 18], rot: -90 },
    { p: [18, rampY, -19], rot: 0 },
    { p: [-18, rampY, 19], rot: 180 },
  ];
  for (const ramp of ramps) {
    brushes.push({ p: ramp.p, s: [4.5, 0.5, rampLen], kind: 'ramp', rot: ramp.rot, pitch: rampPitch });
  }

  // --- Staircases: a second, slower way onto the deck ---------------------
  // Placed on the two axes the ramps do not use, so each quadrant has an ascent of some kind and
  // the routes up are spread around the arena rather than clustered.
  // Bottom is on the deck facing the arena centre; the top lands on the ring's inner edge. Run
  // these the wrong way round and the flight climbs to a landing attached to nothing.
  brushes.push(...buildStairs([-9, 0, -14.5], [-9, UPPER, -24.5], 3.4));
  brushes.push(...buildStairs([9, 0, 14.5], [9, UPPER, 24.5], 3.4));
  // Side rails so the flights read as architecture and stop you walking off sideways.
  for (const [sx, sz] of [
    [-9, -19.5],
    [9, 19.5],
  ]) {
    for (const side of [-1, 1]) {
      brushes.push({
        p: [sx + side * 1.85, UPPER / 2 + 0.6, sz],
        s: [0.22, 1.0, 10.5],
        kind: 'glass',
        noNav: true,
      });
    }
  }

  // --- Dark room: a lightless flanking wing -------------------------------
  // Enclosed on three sides with a single doorway, deliberately starved of fixtures. The only
  // thing readable inside is emissive team trim and the glow strips at ankle height, which makes
  // it the one place in the arena where standing still is genuinely strong.
  const darkX = -21;
  const darkZ = 6;
  const darkHalf = 5.5;
  for (const [ox, oz, sx, sz] of [
    [0, -darkHalf, darkHalf * 2, 0.6],
    [-darkHalf, 0, 0.6, darkHalf * 2],
    [0, darkHalf, darkHalf * 2, 0.6],
  ] as Array<[number, number, number, number]>) {
    brushes.push({
      p: [darkX + ox, 1.6, darkZ + oz],
      s: [sx, 3.2, sz],
      kind: 'wall',
      color: 0x161c25,
    });
  }
  // Roof. Without it the room is a walled pen, not a dark room: the ceiling fixtures light it as
  // brightly as the open floor and the whole point is lost.
  brushes.push({
    p: [darkX, 3.3, darkZ],
    s: [darkHalf * 2 + 0.6, 0.4, darkHalf * 2 + 0.6],
    kind: 'wall',
    color: 0x161c25,
    noNav: true,
    noShadow: true,
  });

  // Interior cover, and ankle-height glow strips that are the only light source.
  brushes.push({ p: [darkX - 1.5, 0.7, darkZ], s: [2.2, 1.4, 2.2], kind: 'barrier', color: 0x181e28 });
  brushes.push({ p: [darkX + 2.5, 0.7, darkZ - 3], s: [2.2, 1.4, 2.2], kind: 'barrier', color: 0x181e28 });
  for (const [gx, gz, gsx, gsz] of [
    [0, -darkHalf + 0.4, darkHalf * 2 - 1, 0.12],
    [-darkHalf + 0.4, 0, 0.12, darkHalf * 2 - 1],
    [0, darkHalf - 0.4, darkHalf * 2 - 1, 0.12],
  ] as Array<[number, number, number, number]>) {
    brushes.push({
      p: [darkX + gx, 0.06, darkZ + gz],
      s: [gsx, 0.12, gsz],
      kind: 'trim',
      glow: 2.2,
      color: 0x2de0ff,
      noCollide: true,
      noNav: true,
    });
  }

  // --- Ground-floor maze, mirrored into all four quadrants ----------------
  for (let k = 0; k < 4; k++) {
    for (const b of QUADRANT_MAZE) brushes.push(rotateBrush(b, k));
    for (const b of QUADRANT_TRIM) brushes.push(rotateBrush(b, k));
  }

  // --- Animated LED wall panels (decorative, emissive) --------------------
  for (const sign of [-1, 1]) {
    brushes.push({ p: [0, 6.4, sign * (HALF - 0.6)], s: [22, 3, 0.15], kind: 'led', glow: 2.2, noCollide: true, noNav: true });
    brushes.push({ p: [sign * (HALF - 0.6), 6.4, 0], s: [0.15, 3, 22], kind: 'led', glow: 2.2, noCollide: true, noNav: true });
  }

  return brushes;
}

function buildSpawns(): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  // Yaw 0 looks down -Z, so facing direction d is yaw = atan2(-d.x, -d.z). To look at the arena
  // centre from (x, z) that is atan2(x, z). Getting this backwards points every spawn at the
  // corner wall behind it, which reads as "the arena did not load".
  const facingCentre = (x: number, z: number): number => (Math.atan2(x, z) * 180) / Math.PI;

  const corners: Array<{ team: TeamId; x: number; z: number }> = [
    { team: 'red', x: -25, z: -25 },
    { team: 'blue', x: 25, z: 25 },
    { team: 'green', x: -25, z: 25 },
    { team: 'yellow', x: 25, z: -25 },
  ];
  for (const c of corners) {
    // Three ground spawns spread along the corner, plus one on the ring above it. Each looks at
    // the arena rather than at the wall it has its back to.
    const push = (x: number, y: number, z: number) =>
      spawns.push({ p: [x, y, z], yaw: facingCentre(x, z), team: c.team });
    push(c.x, 0.1, c.z);
    push(c.x + Math.sign(-c.x) * 3.5, 0.1, c.z);
    push(c.x, 0.1, c.z + Math.sign(-c.z) * 3.5);
    push(c.x * 0.96, UPPER + 0.1, c.z * 0.96);
  }
  // Neutral spawns used by Free For All and as overflow when a team spawn is contested.
  const neutral: Array<[number, number, number]> = [
    [0, 0.1, -20],
    [0, 0.1, 20],
    [-20, 0.1, -6],
    [20, 0.1, 0],
    [-12, 0.1, -12],
    [12, 0.1, 12],
    [-12, 0.1, 12],
    [12, 0.1, -12],
    [0, UPPER + 0.1, -13],
    [0, UPPER + 0.1, 13],
  ];
  for (const [x, y, z] of neutral) {
    spawns.push({ p: [x, y, z], yaw: facingCentre(x, z), neutral: true });
  }
  return spawns;
}

/**
 * Interactive dressing.
 *
 * The four objective-room doorways get powered doors, which is the one prop with real gameplay
 * weight: holding the centre now means watching four openings that announce themselves when
 * someone approaches. Everything else is atmosphere placed where players actually look — corner
 * sightlines, the ramp approaches, and above the objective room.
 */
function buildProps(): PropSpec[] {
  const props: PropSpec[] = [];
  const roomHalf = 8;

  // Powered doors on each face of the objective room, in the 4 m doorway gaps.
  const doorways: Array<{ x: number; z: number; rot: number }> = [
    { x: 0, z: -roomHalf, rot: 0 },
    { x: 0, z: roomHalf, rot: 0 },
    { x: -roomHalf, z: 0, rot: 90 },
    { x: roomHalf, z: 0, rot: 90 },
  ];
  doorways.forEach((d, i) => {
    props.push({
      id: `objective_door_${i}`,
      kind: 'door',
      p: [d.x, 1.4, d.z],
      s: [4, 2.8, 0.35],
      rot: d.rot,
      color: 0x2de0ff,
      travel: 4,
      triggerRadius: 4.2,
    });
  });

  // Energy gates across the ramp mouths: pure light, no collision, but they read as thresholds.
  const gates: Array<{ x: number; z: number; rot: number }> = [
    { x: -11.5, z: -18, rot: 90 },
    { x: 11.5, z: 18, rot: 90 },
    { x: 18, z: -11.5, rot: 0 },
    { x: -18, z: 11.5, rot: 0 },
  ];
  gates.forEach((g, i) => {
    props.push({
      id: `ramp_gate_${i}`,
      kind: 'energy_gate',
      p: [g.x, 1.5, g.z],
      s: [4.5, 3, 0.1],
      rot: g.rot,
      color: 0x2de0ff,
      period: 3.2,
      phase: i / 4,
    });
  });

  // Extraction fans high on each wall.
  const fans: Array<[number, number, number]> = [
    [0, 7.4, -29],
    [0, 7.4, 29],
    [-29, 7.4, 0],
    [29, 7.4, 0],
  ];
  fans.forEach((p, i) => {
    props.push({
      id: `fan_${i}`,
      kind: 'fan',
      p,
      s: [3.2, 3.2, 0.5],
      rot: i >= 2 ? 90 : 0,
      color: 0x4d6070,
      period: 2.4 + i * 0.3,
    });
  });

  // Beacons over the objective room roof and each corner spawn.
  const beacons: Array<{ p: [number, number, number]; color: number }> = [
    { p: [0, 6.4, 0], color: 0xffd84d },
    { p: [-25, 3.6, -25], color: 0xff2d55 },
    { p: [25, 3.6, 25], color: 0x2d7bff },
    { p: [-25, 3.6, 25], color: 0x2dff87 },
    { p: [25, 3.6, -25], color: 0xffd42d },
  ];
  beacons.forEach((b, i) => {
    props.push({
      id: `beacon_${i}`,
      kind: 'warning_light',
      p: b.p,
      s: [0.5, 0.5, 0.5],
      color: b.color,
      period: 1.8,
      phase: i / 5,
    });
  });

  // Match clock on the objective room's outer faces, plus scrolling signage on the perimeter.
  for (let i = 0; i < 4; i++) {
    const rot = i * 90;
    const rad = (rot * Math.PI) / 180;
    props.push({
      id: `clock_${i}`,
      kind: 'display',
      p: [Math.sin(rad) * -(roomHalf + 0.5), 4.0, Math.cos(rad) * -(roomHalf + 0.5)],
      s: [3.4, 1.1, 0.12],
      rot,
      color: 0x2de0ff,
      text: 'clock',
    });
  }
  // --- Venue infrastructure ------------------------------------------------
  //
  // The arena declares *what* each board reports; `VenueBoards` decides how it looks. Placement
  // follows one rule: a board must be readable from the space it describes. The scoreboards face
  // the two team approaches to the centre, the elimination feed sits where players regroup after
  // dying, and the round status hangs above the objective everyone is already looking at.

  // Twin scoreboards on the north and south perimeter, angled into the room.
  const scoreboards: Array<{ id: string; p: [number, number, number]; rot: number }> = [
    { id: 'scoreboard_north', p: [0, 5.4, -29.2], rot: 0 },
    { id: 'scoreboard_south', p: [0, 5.4, 29.2], rot: 180 },
  ];
  for (const board of scoreboards) {
    props.push({
      id: board.id,
      kind: 'display',
      p: board.p,
      s: [10, 2.6, 0.12],
      rot: board.rot,
      color: 0x8fefff,
      text: 'scoreboard',
    });
  }

  // Elimination feed on the east and west walls, at the height a player scans while moving.
  const feeds: Array<{ id: string; p: [number, number, number]; rot: number }> = [
    { id: 'feed_west', p: [-29.2, 4.2, 0], rot: 90 },
    { id: 'feed_east', p: [29.2, 4.2, 0], rot: -90 },
  ];
  for (const feed of feeds) {
    props.push({
      id: feed.id,
      kind: 'display',
      p: feed.p,
      s: [7, 1.9, 0.12],
      rot: feed.rot,
      color: 0x8fefff,
      text: 'killfeed',
    });
  }

  // Control bar above the objective room, on all four faces — the one board that answers
  // "who is winning" without arithmetic.
  for (let i = 0; i < 4; i++) {
    const rot = i * 90;
    const rad = (rot * Math.PI) / 180;
    props.push({
      id: `control_${i}`,
      kind: 'display',
      p: [Math.sin(rad) * -(roomHalf + 0.5), 5.6, Math.cos(rad) * -(roomHalf + 0.5)],
      s: [3.4, 1.1, 0.12],
      rot,
      color: 0x2de0ff,
      text: 'objective',
    });
  }

  // Round status over each spawn approach, so a respawning player learns the match state before
  // they reach the fight.
  const statusBoards: Array<{ id: string; p: [number, number, number]; rot: number }> = [
    { id: 'status_red', p: [-29.2, 3.0, -18], rot: 90 },
    { id: 'status_blue', p: [29.2, 3.0, 18], rot: -90 },
  ];
  for (const board of statusBoards) {
    props.push({
      id: board.id,
      kind: 'display',
      p: board.p,
      s: [6, 1.5, 0.12],
      rot: board.rot,
      color: 0x8fefff,
      text: 'roundstatus',
    });
  }

  // --- Branding ------------------------------------------------------------
  //
  // Fictional league and sponsor signage. Deliberately restrained in colour: branding uses the
  // house cyan and warm neutrals, never a team colour, because team colour is a reserved channel
  // and a red sponsor board would read as red territory. See VISUAL_STYLE_GUIDE.md.
  const signage: Array<{ id: string; p: [number, number, number]; rot: number; text: string; color: number }> = [
    { id: 'sign_north', p: [0, 3.2, -29.2], rot: 0, text: 'PHOTON ARENA 01 — CLASSIC', color: 0x8fefff },
    { id: 'sign_south', p: [0, 3.2, 29.2], rot: 180, text: 'PHOTON LEAGUE — DIVISION ONE', color: 0x8fefff },
    { id: 'sign_west', p: [-29.2, 6.0, 14], rot: 90, text: 'HALCYON OPTICS · VECTOR DYNAMICS · MERIDIAN CELL', color: 0xffc93d },
    { id: 'sign_east', p: [29.2, 6.0, -14], rot: -90, text: 'SECTOR 01 · UPPER DECK · KEEP CLEAR OF EMITTERS', color: 0xffc93d },
  ];
  for (const sign of signage) {
    props.push({
      id: sign.id,
      kind: 'display',
      p: sign.p,
      s: [9, 1.4, 0.12],
      rot: sign.rot,
      color: sign.color,
      text: sign.text,
    });
  }

  // Ambient machinery humming in the corners.
  const machines: Array<[number, number, number]> = [
    [-28, 1.1, -14],
    [28, 1.1, 14],
    [-14, 1.1, 28],
    [14, 1.1, -28],
  ];
  machines.forEach((p, i) => {
    props.push({
      id: `machine_${i}`,
      kind: 'machine',
      p,
      s: [2.2, 2.2, 1.4],
      rot: i % 2 === 0 ? 0 : 90,
      color: 0x39465a,
      period: 4 + i * 0.5,
      phase: i / 4,
    });
  });

  return props;
}

export const ARENA_01_CLASSIC: ArenaDefinition = {
  id: 'arena01_classic',
  name: 'Classic',
  description: 'Two-floor laser tag hall. Catwalk ring, four ramps, central objective room.',
  bounds: [-HALF, -HALF, HALF, HALF],
  ceilingY: WALL_H,
  // Fog is thin enough to keep the far wall legible from the centre: at 40 m an exp2 density of
  // 0.007 still passes ~92% of the surface colour. Denser than this and the arena loses its shape.
  fogDensity: 0.007,
  // Surface albedos sit in the mid-dark range rather than near-black. Bloom and neon need somewhere
  // to sit *against*; if the base surfaces are 0x14-ish there is no tonal separation left after
  // ACES tone mapping and the whole arena reads as a black screen with a few glowing lines.
  palette: {
    floor: 0x2b3340,
    wall: 0x353f4d,
    catwalk: 0x3f4a5b,
    barrier: 0x3a4451,
    pillar: 0x455161,
    ramp: 0x3c4655,
    glass: 0x63aed2,
    led: 0x2de0ff,
    trim: 0x2de0ff,
    fog: 0x0e1826,
    ambient: 0x3d5c85,
  },
  floorHeights: [0, UPPER],
  brushes: buildBrushes(),
  props: buildProps(),
  // Intensities are in physical units (illuminance ≈ intensity / d²). A ceiling fixture 7 m above
  // the deck needs ~350 to put ~1.0 on the floor beneath it; the previous values of 20–40 were
  // legacy-model numbers and produced roughly 0.05 — visually black.
  lights: [
    { p: [0, 7.5, 0], color: 0x8fefff, intensity: 620, distance: 48 },
    { p: [0, 3.2, 0], color: 0x2de0ff, intensity: 150, distance: 20 },
    { p: [-18, 6.5, -18], color: 0xff6d88, intensity: 380, distance: 34 },
    { p: [18, 6.5, 18], color: 0x6d9dff, intensity: 380, distance: 34 },
    { p: [-18, 6.5, 18], color: 0x6dffb0, intensity: 380, distance: 34 },
    { p: [18, 6.5, -18], color: 0xffe06d, intensity: 380, distance: 34 },
    { p: [0, 7.2, -24], color: 0xa8ccff, intensity: 300, distance: 32, optional: true },
    { p: [0, 7.2, 24], color: 0xa8ccff, intensity: 300, distance: 32, optional: true },
    { p: [-24, 7.2, 0], color: 0xa8ccff, intensity: 300, distance: 32, optional: true },
    { p: [24, 7.2, 0], color: 0xa8ccff, intensity: 300, distance: 32, optional: true },
    { p: [-12, 2.6, 12], color: 0xb18bff, intensity: 130, distance: 18, optional: true },
    { p: [12, 2.6, -12], color: 0xb18bff, intensity: 130, distance: 18, optional: true },
  ],
  spawns: buildSpawns(),
  objectives: [
    { id: 'central_hill', kind: 'hill', p: [0, 1.2, 0], s: [10, 4, 10] },
    { id: 'flag_red', kind: 'flag', p: [-25, 0.6, -25], s: [1.2, 1.6, 1.2], team: 'red' },
    { id: 'flag_blue', kind: 'flag', p: [25, 0.6, 25], s: [1.2, 1.6, 1.2], team: 'blue' },
    { id: 'cap_a', kind: 'capture_point', p: [0, 0.6, -18], s: [6, 3, 6] },
    { id: 'cap_b', kind: 'capture_point', p: [0, 0.6, 0], s: [6, 3, 6] },
    { id: 'cap_c', kind: 'capture_point', p: [0, 0.6, 18], s: [6, 3, 6] },
  ],
  reverbZones: [
    { p: [0, 2.5, 0], s: [17, 5, 17], wetness: 0.62, decaySeconds: 1.9 },
    { p: [0, 2.5, 0], s: [60, 10, 60], wetness: 0.3, decaySeconds: 1.2 },
  ],
  // Territory. Centred on each team's spawn cluster and sized so the colour reaches roughly to the
  // first corner a player turns after leaving the spawn room — far enough to orient by, not so far
  // that the two halves meet and the middle of the arena becomes muddy. The neutral band between
  // them is deliberate: the centre of the map belongs to nobody until someone takes it.
  teamZones: [
    { team: 'red', p: [-25, 0, -25], radius: 15, label: 'RED SECTOR' },
    { team: 'blue', p: [25, 0, 25], radius: 15, label: 'BLUE SECTOR' },
  ],
  // The central room reports who holds it. This is the one place in the arena where the lighting is
  // a live readout of the match rather than set dressing.
  reactiveZones: [
    { objectiveId: 'central_hill', p: [0, 0, 0], radius: 11, neutralColor: 0x2de0ff },
  ],
};
