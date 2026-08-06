import type { TeamId } from '@/config/teams';
import type { ArenaDefinition, Brush, PropSpec, SpawnPoint, SurfaceKind } from './MapTypes';

/**
 * ARENA 02 — "Apex"
 *
 * The Photon League's televised venue. Where Arena 01 is a laser-tag hall with a catwalk in it,
 * this is a building designed around a sport: a field, a bowl of seating looking down into it, and
 * a broadcast rig hanging over the top.
 *
 * ## Why this arena exists
 *
 * Sprint 15 tried to put a spectator bowl into Arena 01 and proved it could not be done. That hall
 * is 9 m of roof over a 5 m deck, and the deck walkway runs to within 0.5 m of the wall — four
 * metres of wall with players using the lower half. Galleries there can only ever be relief a few
 * centimetres deep. The limit was structural, so the fix has to be structural.
 *
 * ## The section, which is the whole design
 *
 * ```
 *   28 m  roof
 *   26 m  lighting truss grid
 *   22 m  broadcast booths · commentary · camera gantry ring
 *   18 m  VIP suites (curved, cantilevered)
 *   16 m  upper spectator tier
 *   12 m  lower spectator tier · LED ribbon · TOP OF THE CONTAINMENT WALL
 *   ----------------------- top of play -----------------------
 *    9 m  sky bridges          <- third player level
 *    5 m  mezzanine ring       <- second player level
 *    0 m  field                <- first player level
 * ```
 *
 * Three player levels instead of two, and a 12 m containment wall that no player surface comes
 * within three metres of. Everything above that line is spectator architecture: real rooms with
 * real volume, not decals.
 *
 * ## The trick that makes the bowl free
 *
 * `bounds` is the **play space**, not the building. The field is 60 x 60 exactly as Arena 01 was, so
 * navigation sampling, the minimap and the heatmaps cost precisely what they cost before. The
 * building is 84 x 84 — a 12 m ring outside the play boundary that holds the entire seating bowl.
 *
 * That ring is also why the seating can be deep enough to read as a bowl. It is outside the wall, so
 * it can be as generous as it likes without ever touching a sight line a player uses.
 *
 * And because navigation casts downward from `ceilingY + 1` (here 11.6 m), every spectator surface —
 * all of it above 12 m — is invisible to the bake without a single exclusion flag. The bowl cannot
 * grow a bot pathing bug because the bake never sees it.
 *
 * ## Symmetry
 *
 * Arena 01 is four-fold rotationally symmetric, which guarantees balance but also guarantees that
 * every quadrant looks the same — the single biggest reason it reads as a prototype.
 *
 * Apex is **two-fold** (180 degrees). Red at (-25, -25) maps exactly onto blue at (25, 25), and
 * green onto yellow, so every team pair is still perfectly balanced. But opposite walls are free to
 * be different buildings — the Broadcast Tower to the north, the Fusion Reactor to the south — so
 * half the repetition goes away at no cost in fairness.
 *
 * ## The plan
 *
 * The four **wall midpoints** are landmarks and the four **corners** are spawns. That division is
 * what makes the arena navigable: every wall has a different building on it, so "north" and "west"
 * are things you can see rather than compass directions you have to remember.
 *
 * ```
 *            N — Broadcast Tower
 *      +-----------------------------+
 *      | red                         |     corners: team spawns
 *      |        \   spoke   /        |     wall midpoints: landmarks
 *   W  |          ( atrium )         |  E  mezzanine: 4 corner brackets
 *  Walk|        /           \        | Deck            + 4 diagonal spokes
 *      |                        blue |
 *      +-----------------------------+
 *            S — Fusion Reactor
 * ```
 *
 * The first cut of this arena put the Tower and the Reactor on the spawn diagonals, and the
 * structural audit rejected it immediately: four spawn points were inside the drum walls and
 * unreachable, and team path distances to the objective differed by 84%. Landmarks and spawns want
 * the same real estate, and the audit is the thing that says so before anyone looks at it.
 *
 * The Sky Deck is mirrored to both the east and the west walls rather than built once. Its 180
 * degree counterpart has to be an equally strong position or the arena hands the best ground to one
 * team, and a ground-level colonnade is not an equal counterpart to the highest platform in the
 * building.
 */

// --- The section -----------------------------------------------------------

/** Half the play field. Matches Arena 01 exactly, so nav and minimap costs are unchanged. */
const PLAY_HALF = 30;
/** Half the building. The 12 m difference is the spectator ring. */
const BOWL_HALF = 42;

const MEZZ = 5.0; // Second player level: the ring around the atrium.
const SKY = 9.0; // Third player level: bridges over the atrium.
const SLAB = 0.35;

/** Top of the containment wall. Clear of the highest player surface by more than a body height. */
const PLAY_TOP = 12.6;

/**
 * Where navigation stops looking.
 *
 * Sampling casts down from `ceilingY + 1`, so this must sit above the sky bridges and below the
 * lowest spectator surface. The upper bridge is at 11.2 and the first row of seating is at 13.0, so
 * 11.4 casts from 12.4 — 1.2 m of clearance over the bridge and 0.6 m under the bowl.
 *
 * Both margins matter. Too low and the upper bridge is invisible to the bake, so bots will not use
 * the arena's best flanking route. Too high and the bake starts sampling seating rows, and bots
 * path into the crowd.
 */
const NAV_TOP = 11.4;

const TIER_A = 13.0; // Lower bowl, front row, immediately behind the wall.
const TIER_B = 17.2; // Upper bowl.
const SUITE_Y = 19.4; // VIP suites and press boxes.
const BOOTH_Y = 22.5; // Broadcast booths and the camera gantry ring.
const TRUSS_Y = 26.0; // Lighting truss grid.
const ROOF_Y = 28.0;

/** The central void. Nothing structural crosses it below the mezzanine. */
const ATRIUM_R = 11.5;
/** Centreline of the mezzanine balcony ring: a 10 m band from the void edge outward. */
const BALCONY_R = 16.5;
/** The upper sky bridge, which passes over the lower one. */
const SKY_B = SKY + 2.2;
/** Centreline of the mezzanine corner brackets, and of the arms that form them. */
const ARM_D = 25.5;

// --- Colours ---------------------------------------------------------------
//
// Render batches key on (kind, colour, glow), so every distinct override is a draw call. This is the
// entire override set for the arena — six values, deliberately.

const C_DARK = 0x1b2029; // Recesses, shadowed backs, the inside of the bowl.
const C_SEAT = 0x2a323f; // Seating tiers.
const C_STRUCT = 0x4a5666; // Exposed structure: trusses, gantries, arches.
const C_SUITE = 0xffc27a; // Warm glass. The only warm colour in the building.
const C_AMBER = 0xffc93d; // Champion's Walk trim.
const C_CORE = 0x2de0ff; // House cyan.

// --- Helpers ---------------------------------------------------------------

/**
 * A point on a circle, in the engine's yaw convention.
 *
 * Yaw 0 faces -Z, and a box rotated by `r` has its local +X along (cos r, 0, -sin r) and its local
 * +Z along (sin r, 0, cos r). So a brush placed at angle t with `rot = t` gets local X tangential
 * and local Z radial — which is what every curved element here relies on. Getting this backwards
 * builds a circle out of boxes all facing the same way, which reads as a pile of crates.
 */
function onCircle(radius: number, degrees: number): [number, number] {
  const t = (degrees * Math.PI) / 180;
  return [Math.sin(t) * radius, Math.cos(t) * radius];
}

/**
 * Approximates a circular band with `count` chord segments.
 *
 * This is how every curve in the arena is built. The engine has axis-aligned boxes with a yaw, so a
 * curve is a polygon with enough sides that the eye stops counting them — at 24 segments an 11 m
 * radius has a 3 m chord and a 10 cm sagitta, which is below the noise of the surface detail.
 *
 * Segments overlap by 4% so the joints never open a seam a player could see through or a bullet
 * could pass along.
 */
function arc(
  opts: {
    radius: number;
    y: number;
    /** Radial thickness (local Z) for walls, radial depth for floors. */
    depth: number;
    height: number;
    kind: SurfaceKind;
    count?: number;
    /** Arc extent in degrees. Defaults to the full circle. */
    from?: number;
    to?: number;
  } & Partial<Brush>,
): Brush[] {
  const { radius, y, depth, height, kind, count = 24, from = 0, to = 360, ...rest } = opts;
  const span = to - from;
  const full = Math.abs(span) >= 359.9;
  const segments = full ? count : Math.max(1, Math.round((count * Math.abs(span)) / 360));
  const step = span / segments;
  const chord = 2 * radius * Math.sin((Math.abs(step) * Math.PI) / 360) * 1.04 + 0.05;

  const out: Brush[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = from + step * (i + 0.5);
    const [x, z] = onCircle(radius, angle);
    out.push({ ...rest, p: [x, y, z], s: [chord, height, depth], kind, rot: angle });
  }
  return out;
}

/**
 * Rotates a brush 180 degrees about the arena centre.
 *
 * Two-fold symmetry only needs a sign flip, which is why it costs nothing to author a half and get
 * a perfectly fair opposite half for free. Sizes are unchanged — a 180 degree turn does not swap
 * the X and Z extents the way a 90 degree turn does.
 */
function mirror180(b: Brush): Brush {
  return { ...b, p: [-b.p[0], b.p[1], -b.p[2]], rot: (b.rot ?? 0) + 180 };
}

/**
 * Splits a run into segments, leaving openings at the given centres.
 *
 * Railings stop accidental falls and read as architecture, but an unbroken one severs the level: it
 * sits over the point where a bridge lands, drops headroom below crouch height, and the navigation
 * bake correctly refuses to link across it. Every place traffic crosses a rail gets an opening.
 */
function segmentsAlong(
  span: number,
  gaps: Array<{ at: number; halfWidth: number }>,
): Array<{ centre: number; length: number }> {
  const sorted = [...gaps].sort((a, b) => a.at - b.at);
  const out: Array<{ centre: number; length: number }> = [];
  let cursor = -span;
  for (const gap of sorted) {
    const start = gap.at - gap.halfWidth;
    if (start > cursor) out.push({ centre: (cursor + start) / 2, length: start - cursor });
    cursor = Math.max(cursor, gap.at + gap.halfWidth);
  }
  if (span > cursor) out.push({ centre: (cursor + span) / 2, length: span - cursor });
  return out;
}

/**
 * Emits a flight of steps from `from` up to `to`.
 *
 * Rise per step stays under the character controller's autostep height, so climbing needs no jump
 * and no special-casing, and the navigation bake links them like any other walkable surface.
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
  const steps = Math.max(2, Math.ceil(rise / 0.34));
  const stepRise = rise / steps;
  const tread = runLength / steps;
  const yaw = (Math.atan2(runX, runZ) * 180) / Math.PI;

  const out: Brush[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    out.push({
      p: [from[0] + runX * t, from[1] + stepRise * (i + 1) - stepRise / 2 - 0.15, from[2] + runZ * t],
      s: [width, stepRise + 0.3, tread],
      kind,
      rot: yaw,
    });
  }
  return out;
}

/**
 * A helical flight wrapping a cylinder.
 *
 * Used once, on the Broadcast Tower. A spiral is the only ascent in the arena that does not show
 * you where it is going, which is exactly why the tower feels like a different kind of space to
 * fight in — you arrive at each level without having seen it first.
 */
function buildSpiral(
  centre: [number, number],
  radius: number,
  fromY: number,
  toY: number,
  fromDeg: number,
  turns: number,
  width: number,
): Brush[] {
  const steps = Math.max(4, Math.ceil((toY - fromY) / 0.32));
  const stepRise = (toY - fromY) / steps;
  const out: Brush[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = fromDeg + (turns * 360 * (i + 0.5)) / steps;
    const [dx, dz] = onCircle(radius, angle);
    out.push({
      p: [centre[0] + dx, fromY + stepRise * (i + 1) - stepRise / 2 - 0.16, centre[1] + dz],
      // Local X tangential (the tread runs around the drum), local Z radial (its width).
      s: [2.0, stepRise + 0.32, width],
      kind: 'catwalk',
      rot: angle,
    });
  }
  return out;
}

/** Chest-high glass railing along a straight run. */
function railing(
  p: [number, number, number],
  length: number,
  rot: number,
  gaps: number[] = [],
): Brush[] {
  const out: Brush[] = [];
  for (const seg of segmentsAlong(length / 2, gaps.map((at) => ({ at, halfWidth: 2.6 })))) {
    const t = (rot * Math.PI) / 180;
    out.push({
      p: [p[0] + Math.cos(t) * seg.centre, p[1] + 0.55, p[2] - Math.sin(t) * seg.centre],
      s: [seg.length, 1.1, 0.22],
      kind: 'glass',
      rot,
      noNav: true,
    });
  }
  return out;
}

// ===========================================================================
//  THE BUILDING
// ===========================================================================

function buildShell(): Brush[] {
  const out: Brush[] = [];

  // Field.
  out.push({ p: [0, -0.5, 0], s: [PLAY_HALF * 2, 1, PLAY_HALF * 2], kind: 'floor' });

  // The concourse floor of the spectator ring, one slab under the whole building. Outside the play
  // boundary and above nothing a player can reach, so it is pure backdrop.
  out.push({
    p: [0, -0.5, 0],
    s: [BOWL_HALF * 2, 1, BOWL_HALF * 2],
    kind: 'floor',
    color: C_DARK,
    noNav: true,
  });

  // --- The containment wall ------------------------------------------------
  //
  // 12 m, which is the number the whole arena turns on. Arena 01's wall was 9 m with a deck at 5,
  // leaving four metres for a bowl. This leaves twelve, and no player surface comes within three
  // metres of the top of it.
  for (const sign of [-1, 1]) {
    out.push({
      p: [0, PLAY_TOP / 2, sign * PLAY_HALF],
      s: [PLAY_HALF * 2, PLAY_TOP, 1],
      kind: 'wall',
    });
    out.push({
      p: [sign * PLAY_HALF, PLAY_TOP / 2, 0],
      s: [1, PLAY_TOP, PLAY_HALF * 2],
      kind: 'wall',
    });
  }

  // Roof over the whole building. It must not cast shadows: a slab spanning the arena would
  // otherwise occlude the key light and put every surface below it in full shadow.
  out.push({
    p: [0, ROOF_Y, 0],
    s: [BOWL_HALF * 2, 0.8, BOWL_HALF * 2],
    kind: 'wall',
    color: C_DARK,
    noNav: true,
    noShadow: true,
  });

  // Outer skin of the building, behind the top row of the bowl.
  for (const sign of [-1, 1]) {
    out.push({
      p: [0, ROOF_Y / 2 + 4, sign * BOWL_HALF],
      s: [BOWL_HALF * 2, ROOF_Y, 1],
      kind: 'wall',
      color: C_DARK,
      noNav: true,
    });
    out.push({
      p: [sign * BOWL_HALF, ROOF_Y / 2 + 4, 0],
      s: [1, ROOF_Y, BOWL_HALF * 2],
      kind: 'wall',
      color: C_DARK,
      noNav: true,
    });
  }

  return out;
}

/**
 * The spectator bowl.
 *
 * Real rooms with real volume in the 12 m ring outside the play boundary, exactly as the brief
 * demands. None of it collides with anything a player can reach and none of it is sampled for
 * navigation, because all of it is above `ceilingY`.
 *
 * The rake is the point. Each tier steps up **and back**, so from the field you see a receding
 * stack of edges rather than a flat wall — that recession is what the eye reads as a crowd of
 * people, and it is the thing Arena 01 physically could not provide.
 */
function buildBowl(): Brush[] {
  const out: Brush[] = [];

  // Per wall: `sign` is the outward direction, `axis` says which world axis the wall runs along.
  const walls: Array<{ axis: 'x' | 'z'; sign: number }> = [
    { axis: 'x', sign: -1 },
    { axis: 'x', sign: 1 },
    { axis: 'z', sign: -1 },
    { axis: 'z', sign: 1 },
  ];

  /** Places a run along a wall: `out` is metres outboard of the play boundary. */
  const along = (
    wall: { axis: 'x' | 'z'; sign: number },
    outward: number,
    y: number,
    length: number,
    thickness: number,
    height: number,
    brush: Partial<Brush> & { kind: SurfaceKind },
  ): Brush => {
    const d = PLAY_HALF + outward;
    if (wall.axis === 'z') {
      return { ...brush, p: [0, y, wall.sign * d], s: [length, height, thickness], rot: 0 };
    }
    return { ...brush, p: [wall.sign * d, y, 0], s: [thickness, height, length], rot: 0 };
  };

  for (const wall of walls) {
    const runLength = PLAY_HALF * 2;

    // Parapet capping the containment wall — the bright edge the bowl sits behind.
    out.push(
      along(wall, 0, PLAY_TOP + 0.25, runLength, 1.4, 0.5, { kind: 'trim', glow: 1.4, noNav: true }),
    );

    // LED ribbon board on the field side of the parapet: the single most recognisable piece of
    // arena furniture there is, and the reason a still frame reads as a televised venue.
    out.push(
      along(wall, -0.62, PLAY_TOP - 0.9, runLength, 0.2, 1.1, {
        kind: 'led',
        glow: 2.6,
        noNav: true,
        noCollide: true,
      }),
    );

    // --- Lower tier: eight raked rows -------------------------------------
    for (let row = 0; row < 8; row++) {
      const outward = 1.1 + row * 0.95;
      const y = TIER_A + row * 0.62;
      // The riser, dark, and the tread edge, lighter. Two values is all it takes to read as seating.
      out.push(
        along(wall, outward, y, runLength - 1, 0.95, 0.62, {
          kind: 'barrier',
          color: C_SEAT,
          noNav: true,
        }),
      );
      out.push(
        along(wall, outward - 0.45, y + 0.32, runLength - 1, 0.1, 0.16, {
          kind: 'barrier',
          color: C_DARK,
          noNav: true,
        }),
      );
    }

    // Vomitory tunnels: the dark voids a crowd walks in and out through. Four per wall, and the one
    // element that stops a raked bank reading as a solid ramp.
    for (const at of [-21, -7, 7, 21]) {
      const outward = 5.4;
      const d = PLAY_HALF + outward;
      const p: [number, number, number] =
        wall.axis === 'z' ? [at, TIER_A + 1.6, wall.sign * d] : [wall.sign * d, TIER_A + 1.6, at];
      const s: [number, number, number] = wall.axis === 'z' ? [3.6, 3.4, 9] : [9, 3.4, 3.6];
      out.push({ p, s, kind: 'wall', color: 0x0a0d13, noNav: true });
    }

    // --- Upper tier, set back behind a cross-aisle -------------------------
    out.push(
      along(wall, 9.4, TIER_B - 1.2, runLength - 1, 1.6, 2.4, {
        kind: 'wall',
        color: C_DARK,
        noNav: true,
      }),
    );
    for (let row = 0; row < 6; row++) {
      const outward = 10.4 + row * 0.85;
      const y = TIER_B + row * 0.66;
      out.push(
        along(wall, outward, y, runLength - 1, 0.85, 0.66, {
          kind: 'barrier',
          color: C_SEAT,
          noNav: true,
        }),
      );
    }
  }

  return out;
}

/**
 * VIP suites, press boxes and the broadcast level.
 *
 * Physical rooms with a floor, a back wall and a lit glass front, on a slower rhythm than the
 * seating below them. The warm glass is the only warm colour in the building, and it is what makes
 * the galleries read as *occupied* rather than as texture.
 */
function buildSuites(): Brush[] {
  const out: Brush[] = [];
  const walls: Array<{ axis: 'x' | 'z'; sign: number }> = [
    { axis: 'x', sign: -1 },
    { axis: 'x', sign: 1 },
    { axis: 'z', sign: -1 },
    { axis: 'z', sign: 1 },
  ];

  for (const wall of walls) {
    for (let i = -2; i <= 2; i++) {
      const at = i * 11.5;
      const d = PLAY_HALF + 8.2;
      const put = (y: number, w: number, h: number, depth: number, b: Partial<Brush> & { kind: SurfaceKind }) => {
        const p: [number, number, number] =
          wall.axis === 'z' ? [at, y, wall.sign * d] : [wall.sign * d, y, at];
        const s: [number, number, number] = wall.axis === 'z' ? [w, h, depth] : [depth, h, w];
        out.push({ ...b, p, s, noNav: true });
      };
      // Floor, roof, and a lit glass front. A box with a front and a back is a room; a lit panel
      // stuck on a wall is a decal, which is what the brief rules out.
      put(SUITE_Y - 1.6, 9.5, 0.3, 5.5, { kind: 'catwalk', color: C_DARK });
      put(SUITE_Y + 1.7, 9.5, 0.3, 5.5, { kind: 'catwalk', color: C_DARK });
      put(SUITE_Y, 9.2, 2.6, 0.2, { kind: 'glass', color: C_SUITE, glow: 1.5 });
      // Mullions either side, so the suites read as a row of separate rooms.
      for (const s of [-1, 1]) {
        const off = s * 4.9;
        const p: [number, number, number] =
          wall.axis === 'z' ? [at + off, SUITE_Y, wall.sign * d] : [wall.sign * d, SUITE_Y, at + off];
        const sz: [number, number, number] = wall.axis === 'z' ? [0.5, 3.6, 5.6] : [5.6, 3.6, 0.5];
        out.push({ p, s: sz, kind: 'pillar', color: C_STRUCT, noNav: true });
      }
    }
  }
  return out;
}

/**
 * The broadcast rig: camera gantry ring and lighting truss grid.
 *
 * A televised sport is defined as much by the machinery pointed at it as by the play. This is the
 * layer that says "cameras are on this" — and it hangs over the field where the eye goes when it
 * follows the atrium upward.
 */
function buildBroadcast(): Brush[] {
  const out: Brush[] = [];

  // Camera gantry: a continuous ring just inside the wall line, on brackets.
  out.push(
    ...arc({
      radius: PLAY_HALF - 2.5,
      y: BOOTH_Y,
      depth: 2.2,
      height: 0.3,
      kind: 'catwalk',
      count: 40,
      color: C_STRUCT,
      noNav: true,
    }),
  );
  out.push(
    ...arc({
      radius: PLAY_HALF - 1.6,
      y: BOOTH_Y + 0.6,
      depth: 0.16,
      height: 1.0,
      kind: 'glass',
      count: 40,
      noNav: true,
    }),
  );

  // Lighting truss grid. Two directions of chords with hangers, which is what a real rig looks like
  // from below and the cheapest possible way to make a 28 m ceiling read as *structure* rather than
  // as an empty grey plane — the single most common failure of a tall room.
  for (let i = -3; i <= 3; i++) {
    const at = i * 9;
    out.push({ p: [at, TRUSS_Y, 0], s: [1.1, 0.9, PLAY_HALF * 2], kind: 'catwalk', color: C_STRUCT, noNav: true, noShadow: true });
    out.push({ p: [0, TRUSS_Y - 1.0, at], s: [PLAY_HALF * 2, 0.9, 1.1], kind: 'catwalk', color: C_STRUCT, noNav: true, noShadow: true });
    // Hangers up to the roof.
    for (let k = -2; k <= 2; k++) {
      out.push({ p: [at, TRUSS_Y + 1.4, k * 12], s: [0.28, 3.6, 0.28], kind: 'pillar', color: C_STRUCT, noNav: true, noShadow: true });
    }
  }

  // Fixture pods clamped under the grid, aimed at the field.
  for (let i = -2; i <= 2; i++) {
    for (let k = -2; k <= 2; k++) {
      out.push({
        p: [i * 13.5, TRUSS_Y - 2.1, k * 13.5],
        s: [1.5, 0.7, 1.5],
        kind: 'led',
        glow: 2.2,
        noNav: true,
        noShadow: true,
        noCollide: true,
      });
    }
  }

  return out;
}

/**
 * LANDMARK 1 — the Photon Core and its atrium.
 *
 * The Core finally has a room built around it. A cylindrical void 23 m across running from the
 * field to the truss grid, with the Core column on its axis, ringed at two levels by balconies and
 * crossed at the top by bridges.
 *
 * The whole arena is organised so that looking up through this void is the shot: the Core, the sky
 * bridges crossing in front of it, the gantry ring, the truss grid, and the bowl beyond the wall.
 */
function buildAtrium(): Brush[] {
  const out: Brush[] = [];

  // Objective platform: a low circular dais, so the middle of the arena has a shape from every
  // approach rather than being an unmarked patch of floor.
  out.push(...arc({ radius: 6.2, y: 0.2, depth: 1.6, height: 0.4, kind: 'catwalk', count: 20 }));
  out.push(...arc({ radius: 6.9, y: 0.42, depth: 0.18, height: 0.1, kind: 'trim', glow: 4.5, count: 20, noCollide: true, noNav: true }));
  out.push({ p: [0, 0.2, 0], s: [10, 0.4, 10], kind: 'catwalk' });

  // Eight columns rising the full height of the atrium. These are the arena's dominant vertical
  // rhythm and the reason the void reads as a room rather than a hole.
  for (let i = 0; i < 8; i++) {
    const angle = i * 45 + 22.5;
    const [x, z] = onCircle(ATRIUM_R + 1.4, angle);
    out.push({ p: [x, TRUSS_Y / 2, z], s: [1.5, TRUSS_Y, 1.5], kind: 'pillar', rot: angle, color: C_STRUCT });
    // Angled brackets where each column meets the mezzanine — cantilever, not a butt joint.
    out.push({ p: [x, MEZZ + 1.1, z], s: [2.6, 0.5, 2.6], kind: 'pillar', rot: angle, color: C_STRUCT, noNav: true });
  }

  // --- Mezzanine: a circular balcony around the void ----------------------
  //
  // Deep enough (10 m) that the stairs up to the sky bridges have somewhere to start. A narrow
  // balcony looks better in plan and is useless in section: every ascent off it ends up too steep
  // for the character controller to climb without a jump.
  out.push(
    ...arc({
      radius: BALCONY_R,
      y: MEZZ - SLAB / 2,
      depth: 10.0,
      height: SLAB,
      kind: 'catwalk',
      count: 28,
    }),
  );
  // Inner railing on the void edge, opened on the four axes where the sky stairs land.
  for (let i = 0; i < 28; i++) {
    const angle = (i * 360) / 28 + 360 / 56;
    if ([0, 90, 180, 270].some((d) => Math.abs(((angle - d + 540) % 360) - 180) < 8)) continue;
    const [x, z] = onCircle(ATRIUM_R + 0.15, angle);
    out.push({
      p: [x, MEZZ + 0.55, z],
      s: [2 * (ATRIUM_R + 0.15) * Math.sin(Math.PI / 28) * 1.06, 1.1, 0.2],
      kind: 'glass',
      rot: angle,
      noNav: true,
    });
  }

  // --- Sky level: two bridges crossing the void on the axes ---------------
  //
  // They cross at different heights so one passes over the other. That overlap is the clearest read
  // of verticality in the building: standing on the upper bridge you watch a fight happen beneath
  // your feet on the lower one.
  //
  // The lower bridge runs north-south and stops short of the Tower and the Reactor. The upper one
  // runs east-west and continues all the way out to the Sky Decks on both walls, which is what
  // makes it a route rather than a balcony.
  const SPAN_A = 32; // z +/- 16
  const SPAN_B = 43; // x +/- 21.5, landing on both Sky Decks
  out.push({ p: [0, SKY - SLAB / 2, 0], s: [5.0, SLAB, SPAN_A], kind: 'catwalk', rot: 0 });
  out.push({ p: [0, SKY_B - SLAB / 2, 0], s: [5.0, SLAB, SPAN_B], kind: 'catwalk', rot: 90 });

  // Arched trusses over each bridge. They spring from above head height so the bridge stays
  // walkable, and they give each span a silhouette you can name from the far side of the arena.
  for (const [rot, baseY, span] of [
    [0, SKY, SPAN_A],
    [90, SKY_B, SPAN_B],
  ] as Array<[number, number, number]>) {
    const t = (rot * Math.PI) / 180;
    for (let i = -4; i <= 4; i++) {
      const along = (i / 4) * (span / 2);
      // A shallow arch: rise falls off with the square of the distance from the middle.
      const rise = 4.4 * (1 - (along / (span / 2)) ** 2);
      out.push({
        p: [Math.sin(t) * along, baseY + 2.6 + rise * 0.5, Math.cos(t) * along],
        s: [5.6, 0.34 + rise * 0.06, 0.5],
        kind: 'catwalk',
        rot,
        color: C_STRUCT,
        noNav: true,
        noShadow: true,
      });
      if (i !== 0) {
        out.push({
          p: [Math.sin(t) * along, baseY + 1.6 + rise * 0.25, Math.cos(t) * along],
          s: [0.26, 2.2 + rise * 0.5, 0.26],
          kind: 'pillar',
          rot,
          color: C_STRUCT,
          noNav: true,
          noShadow: true,
        });
      }
    }
  }

  // --- Bridge landings and railings ---------------------------------------
  //
  // A bridge railed along its whole length is a bridge nothing can arrive on. The first cut railed
  // both spans end to end and landed both sets of stairs half a metre outside the deck, and the
  // bake produced two beautiful floating islands with 238 nodes and no way onto either.
  //
  // So each span gets a landing where its stairs arrive, and the railing is opened there. The
  // landings are worth having anyway: an overlook at the end of a bridge is where players stop and
  // look down the atrium, which is the view the whole building is arranged around.

  // Lower bridge: landings off each end, railed on three sides, open toward the stair.
  for (const sz of [-1, 1]) {
    out.push({ p: [0, SKY - SLAB / 2, sz * 17.5], s: [8, SLAB, 5], kind: 'catwalk' });
    out.push({ p: [0, SKY + 0.55, sz * 19.7], s: [8, 1.1, 0.2], kind: 'glass', noNav: true });
    // Only the far side is railed: the stairs arrive on the near one.
    out.push({ p: [-sz * 3.9, SKY + 0.55, sz * 17.5], s: [0.2, 1.1, 5], kind: 'glass', noNav: true });
  }
  for (const side of [-1, 1]) {
    out.push({ p: [side * 2.45, SKY + 0.55, 0], s: [0.2, 1.1, 30], kind: 'glass', noNav: true });
  }

  // Upper bridge: pads where the stairs arrive, and railings broken across them.
  for (const sx of [-1, 1]) {
    // The pad has to be on the side its own stair climbs from: the west stair rises on +z, so the
    // west pad is at +z, which is `-sx * 3.5`. Getting this sign wrong puts each pad neatly on the
    // opposite side of the span from its staircase, and the bridge and both Sky Decks — 201 nodes,
    // the entire upper level — drop off the graph as one floating island.
    // Five metres deep, not eight. An eight metre pad reaches back over the top of its own
    // staircase, and a flight with a slab 1.28 m above it fails the crouch-headroom probe on every
    // sample — so the steps vanish from the bake for the last two metres and the flight ends in
    // mid-air. This is the same failure as the ramps under the bracket arms, one level up.
    out.push({ p: [sx * 17.5, SKY_B - SLAB / 2, -sx * 2.5], s: [5, SLAB, 5], kind: 'catwalk' });
    for (const side of [-1, 1]) {
      out.push({ p: [sx * (17.5 + side * 2.4), SKY_B + 0.55, -sx * 3.75], s: [0.2, 1.1, 2.5], kind: 'glass', noNav: true });
    }
  }
  for (const side of [-1, 1]) {
    for (const seg of segmentsAlong(21.5, [{ at: -17.5, halfWidth: 2.7 }, { at: 17.5, halfWidth: 2.7 }])) {
      out.push({
        p: [seg.centre, SKY_B + 0.55, side * 2.45],
        s: [seg.length, 1.1, 0.2],
        kind: 'glass',
        noNav: true,
      });
    }
  }

  // Stairs from the balcony up to each bridge end. They run *tangentially* — across the balcony
  // rather than radially off it — because a radial flight has only the balcony's depth to climb in
  // and comes out far too steep to link. Four flights, symmetric under 180 degrees.
  //
  // Each one stops at the bridge's edge rather than at its centreline. The first cut ran them to
  // the middle of the span, which put the top three steps underneath the bridge slab with no
  // headroom, so the bake dropped them and the bridges came out as a floating island of their own.
  out.push(...buildStairs([-12.2, MEZZ, -17.5], [-4.2, SKY, -17.5], 4.2));
  out.push(...buildStairs([12.2, MEZZ, 17.5], [4.2, SKY, 17.5], 4.2));
  out.push(...buildStairs([-17.5, MEZZ, 12.5], [-17.5, SKY_B, 5.0], 4.2));
  out.push(...buildStairs([17.5, MEZZ, -12.5], [17.5, SKY_B, -5.0], 4.2));

  return out;
}

/**
 * LANDMARK 2 — the Broadcast Tower.
 *
 * A drum on the north wall, the only fully circular building in the arena and the only one you
 * climb by spiral. It carries the commentary position at the top, above the play, which is why it
 * has a reason to be tall.
 *
 * Players get its lower two levels. The spiral is the point: it is the one ascent that does not
 * show you where it is going, so you arrive at each landing without having seen it first.
 *
 * On the wall rather than in a corner, because corners are spawns. The first cut of this arena put
 * the drum on the red diagonal and the structural audit found two spawn points inside its wall.
 */
function buildBroadcastTower(): Brush[] {
  const out: Brush[] = [];
  const cx = 0;
  const cz = -24;
  const R = 5.8;

  // Drum, open on the field-facing arc so it is a building you enter rather than a pillar.
  //
  // The opening is centred on angle 0, which is +z — *toward the middle of the arena*. The first
  // cut had it at 180 and so sealed the field side and left the door facing the wall, which the
  // audit found as a spawn point with no path out of it.
  const shell = [
    ...arc({ radius: R, y: MEZZ / 2, depth: 0.7, height: MEZZ, kind: 'wall', count: 20, from: 46, to: 314 }),
    ...arc({ radius: R, y: MEZZ + 2.4, depth: 0.7, height: 4.8, kind: 'wall', count: 20, from: 62, to: 298 }),
  ];
  for (const b of shell) {
    b.p = [b.p[0] + cx, b.p[1], b.p[2] + cz];
  }
  out.push(...shell);

  // Two floors.
  out.push({ p: [cx, MEZZ - SLAB / 2, cz], s: [R * 1.5, SLAB, R * 1.5], kind: 'catwalk', rot: 45 });
  out.push({ p: [cx, SKY_B - SLAB / 2, cz], s: [R * 1.4, SLAB, R * 1.4], kind: 'catwalk', rot: 45 });

  // Spiral from the field to the first floor, then a second flight to the top.
  // Both flights start clear of the doorway. Starting one across it walls the ground floor off from
  // the field, which the audit found as seventeen nodes marooned inside the drum.
  out.push(...buildSpiral([cx, cz], R - 1.5, 0, MEZZ, 100, 0.72, 2.6));
  out.push(...buildSpiral([cx, cz], R - 1.5, MEZZ, SKY_B, 100, 0.66, 2.6));

  // The commentary position: a glazed pod cantilevered off the drum, aimed at the middle.
  const podAngle = 180;
  const [px, pz] = onCircle(R + 2.4, podAngle);
  out.push({ p: [cx + px, BOOTH_Y - 2.4, cz + pz], s: [8, 0.4, 5], kind: 'catwalk', rot: podAngle, color: C_STRUCT, noNav: true });
  out.push({ p: [cx + px, BOOTH_Y, cz + pz], s: [7.6, 3.0, 0.2], kind: 'glass', rot: podAngle, color: C_SUITE, glow: 1.6, noNav: true });
  out.push({ p: [cx + px, BOOTH_Y + 2.2, cz + pz], s: [8, 0.4, 5], kind: 'catwalk', rot: podAngle, color: C_DARK, noNav: true });
  // Diagonal props under the cantilever. A cantilever without visible support reads as a mistake.
  for (const side of [-1, 1]) {
    out.push({
      p: [cx + side * 2.6, BOOTH_Y - 4.6, cz - 2.4],
      s: [0.4, 5.6, 0.4],
      kind: 'pillar',
      rot: podAngle,
      pitch: 20,
      color: C_STRUCT,
      noNav: true,
    });
  }

  // The mast, continuing to the truss grid so the tower ties into the roof structure.
  out.push({ p: [cx, (BOOTH_Y + TRUSS_Y) / 2 + 1.5, cz], s: [2.4, TRUSS_Y - BOOTH_Y + 5, 2.4], kind: 'pillar', color: C_STRUCT, noNav: true });
  out.push(
    ...arc({ radius: 2.0, y: BOOTH_Y + 5.0, depth: 0.3, height: 0.5, kind: 'trim', glow: 3.2, count: 12, noCollide: true, noNav: true }).map(
      (b) => ({ ...b, p: [b.p[0] + cx, b.p[1], b.p[2] + cz] as [number, number, number] }),
    ),
  );

  return out;
}

/**
 * LANDMARK 3 — the Fusion Reactor.
 *
 * The Broadcast Tower's opposite number on the south wall: a stack of vessels with a service
 * walkway spiralling around it and coolant rings glowing through the gaps. Where the tower is
 * precise and vertical, this is heavy and braced, so the two ends of the arena never get confused
 * for one another even in a blurred frame.
 *
 * Players fight around and under it, and the wrap-around walkway is a flanking route onto the
 * mezzanine that never touches a stair.
 */
function buildReactor(): Brush[] {
  const out: Brush[] = [];
  const cx = 0;
  const cz = 23;

  // The vessel: stacked drums of varying radius, so the silhouette bulges rather than reading as a
  // plain cylinder.
  //
  // Sized backwards from the walkway rather than chosen for looks. The service walkway is the only
  // stairless route onto the mezzanine, so it needs a clear 2.4 m tread at radius 5.2 — which caps
  // the widest drum at 3.6. The first cut had a 4.4 m drum growing through the walkway and left the
  // route in three disconnected pieces.
  const drums: Array<[number, number, number]> = [
    [2.6, 1.6, 3.2],
    [3.6, 4.4, 2.4],
    [3.1, 7.4, 2.6],
    [2.0, 10.6, 3.0],
  ];
  for (const [radius, y, height] of drums) {
    out.push(
      ...arc({ radius, y, depth: 0.8, height, kind: 'wall', count: 16, color: C_STRUCT }).map((b) => ({
        ...b,
        p: [b.p[0] + cx, b.p[1], b.p[2] + cz] as [number, number, number],
      })),
    );
  }
  // Coolant rings between the drums — the emissive bands that make it read as machinery.
  for (const [radius, y] of [
    [3.75, 2.9],
    [3.45, 6.0],
    [2.7, 9.0],
  ] as Array<[number, number]>) {
    out.push(
      ...arc({ radius, y, depth: 0.3, height: 0.4, kind: 'led', glow: 2.8, count: 16, noCollide: true, noNav: true }).map((b) => ({
        ...b,
        p: [b.p[0] + cx, b.p[1], b.p[2] + cz] as [number, number, number],
      })),
    );
  }

  // Service walkway spiralling up to mezzanine height: a flanking route with no stairs on it.
  out.push(...buildSpiral([cx, cz], 5.2, 0.4, MEZZ, 20, 0.85, 2.4));

  // Angled buttresses. The stack leans on these; without them it reads as floating.
  for (let i = 0; i < 4; i++) {
    const angle = i * 90 + 45;
    // Outboard of the walkway at 5.6 plus its 1.4 m half-width. Inside it, they cut the only
    // stairless route onto the mezzanine into disconnected fragments.
    const [dx, dz] = onCircle(6.6, angle);
    out.push({
      p: [cx + dx, 3.0, cz + dz],
      s: [0.7, 7.2, 0.7],
      kind: 'pillar',
      rot: angle,
      pitch: 14,
      color: C_STRUCT,
    });
  }

  return out;
}

/**
 * LANDMARK 4 — the Champion's Walk.
 *
 * A colonnade at the middle of the west wall: five tall arched openings onto the field, with a lit
 * niche between each pair for a retired champion's banner.
 *
 * It is the only place in the arena built from repeated *openings* rather than repeated solids, and
 * it is deliberately the calmest space in the building — somewhere the eye rests between the Tower
 * and the atrium, and a corridor whose callout is obvious the first time anyone sees it.
 *
 * Five bays rather than nine: it has to stop clear of the mezzanine corner brackets, which begin
 * 13 m out along each wall.
 */
function buildChampionsWalk(): Brush[] {
  const out: Brush[] = [];
  const x = -26.0;
  const bays = 5;
  const pitch = 4.6;

  for (let i = 0; i < bays; i++) {
    const z = (i - (bays - 1) / 2) * pitch;
    out.push({ p: [x, 3.2, z - pitch / 2], s: [3.4, 6.4, 1.2], kind: 'pillar' });
    // The arch over each opening, stepped from three courses. Boxes cannot curve, but three courses
    // of decreasing width read as an arch at any distance a player sees this from.
    out.push({ p: [x, 6.7, z], s: [3.4, 0.5, 3.5], kind: 'wall', color: C_STRUCT });
    out.push({ p: [x, 7.15, z], s: [3.4, 0.45, 2.6], kind: 'wall', color: C_STRUCT });
    out.push({ p: [x, 7.55, z], s: [3.4, 0.4, 1.7], kind: 'wall', color: C_STRUCT });
    out.push({
      p: [x + 1.5, 3.4, z - pitch / 2],
      s: [0.14, 3.0, 0.8],
      kind: 'led',
      glow: 1.8,
      color: C_AMBER,
      noCollide: true,
      noNav: true,
    });
  }
  // Closing pier at the far end, so the colonnade terminates rather than trailing off.
  out.push({ p: [x, 3.2, (bays - 1) * pitch / 2 + pitch / 2], s: [3.4, 6.4, 1.2], kind: 'pillar' });
  // Back wall and roof, so it is a covered walk rather than a row of gates.
  out.push({ p: [x - 2.0, 4.0, 0], s: [1.0, 8.0, bays * pitch + 1.2], kind: 'wall' });
  out.push({ p: [x - 0.6, 8.0, 0], s: [4.4, 0.5, bays * pitch + 1.2], kind: 'wall', color: C_DARK, noNav: true, noShadow: true });
  // Floor strip, raised a step so it reads as a threshold.
  out.push({ p: [x - 0.6, 0.15, 0], s: [4.4, 0.3, bays * pitch + 1.2], kind: 'catwalk', color: C_DARK });
  out.push({ p: [x + 1.65, 0.16, 0], s: [0.16, 0.32, bays * pitch + 1.2], kind: 'trim', glow: 3.0, color: C_AMBER, noCollide: true, noNav: true });

  return out;
}

/**
 * LANDMARK 5 — the Sky Decks.
 *
 * Overlooks cantilevered off the east and west walls at the height of the upper bridge, which runs
 * straight between them. They are the highest ground in the arena and they look down the length of
 * the atrium at the Core.
 *
 * **Built on both walls, not one.** A single deck would be the strongest position in the building
 * sitting 25 m from blue's spawn and 56 m from red's, and its 180 degree counterpart — a
 * ground-level colonnade — is not an equal answer to it. Mirroring costs eleven brushes and removes
 * the only real balance problem in the plan.
 *
 * Strong, and deliberately expensive to hold: one way up, no cover on the approach, and in full
 * view of both bridges. That trade is what stops the highest ground being the only ground worth
 * taking.
 */
function buildSkyDeck(): Brush[] {
  const half: Brush[] = [];
  const x = 25.5;

  half.push({ p: [x, SKY_B - SLAB / 2, 0], s: [8.0, SLAB, 14.0], kind: 'catwalk' });
  half.push(...railing([x, SKY_B, -6.9], 8.0, 0));
  half.push(...railing([x, SKY_B, 6.9], 8.0, 0));
  half.push(...railing([x + 3.9, SKY_B, 0], 14.0, 90));

  // Cantilever brackets under the deck, angled back into the wall.
  for (const z of [-5.0, 0, 5.0]) {
    half.push({ p: [x + 2.4, SKY_B - 1.8, z], s: [5.5, 0.45, 0.5], kind: 'pillar', pitch: 20, color: C_STRUCT, noNav: true });
  }

  // No stair of its own. The deck's inner edge meets the upper bridge at x = 21.5 at exactly the
  // same height, so the whole sky level is one continuous route — deck, bridge, deck — entered by
  // the two flights off the balcony.
  //
  // It did have one, and it was doing real damage. A flight long enough not to be too steep to
  // climb reached 16.5 m along the wall, which put it directly over the mezzanine corner bracket
  // and stole the headroom from the arm underneath. Bots stopped using the whole west approach: a
  // path from the green bracket to the objective went 77.6 m the wrong way round the building
  // rather than 39.6 m down the stair beside it, and nothing but a path trace would ever show it.

  // A vertical shaft of light behind the deck, so it has a backdrop and the wall carries a landmark
  // of its own when seen from the far side of the arena.
  half.push({ p: [x + 4.2, (SKY_B + PLAY_TOP) / 2 + 1, 0], s: [0.3, PLAY_TOP + 1, 3.0], kind: 'led', glow: 2.4, noCollide: true, noNav: true });

  return [...half, ...half.map(mirror180)];
}

/**
 * The mezzanine: four corner brackets joined to the central balcony by four diagonal spokes.
 *
 * Not a continuous perimeter ring, which is what Arena 01 had and what forced every landmark into a
 * corner. Leaving the four wall midpoints open from the floor to the roof is what gives the Tower,
 * the Reactor, the Walk and the Sky Decks somewhere to be — and it is why each wall of this arena
 * looks like a different building.
 *
 * Each bracket is an L of two arms meeting at the corner, and the ways up are deliberately
 * different from one another: two ramps, one stair, the tower's spiral and the reactor's wrap-around
 * walkway. Five ascents, five different tempos, and no two quadrants that play the same.
 */
function buildMezzanine(): Brush[] {
  const out: Brush[] = [];
  const ringY = MEZZ - SLAB / 2;
  // Where every ascent meets its bracket, measured along the wall from the midpoint. Declared here
  // because the railings need to know it before the ramps are built.
  //
  // 14 rather than 15.5 for a reason found by the audit: a ramp perpendicular to the wall passes
  // under the diagonal spoke on its way up, and at 15.5 the closest approach left 1.28 m of
  // headroom against a 1.45 m crouch clearance. Every sample in that band was dropped, the flight
  // broke in the middle, and the entire mezzanine baked out as an island. Moving to 14 and
  // narrowing the spokes puts the worst case at 2.0 m.
  const UP_AT = 14.0;
  const ARM_W = 5.0;
  const ARM_NEAR = 13.0; // Where an arm starts, measured along the wall from the midpoint.
  const ARM_FAR = 28.0;
  const armMid = (ARM_NEAR + ARM_FAR) / 2;
  const armLen = ARM_FAR - ARM_NEAR;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Arm running along the z walls, and arm running along the x walls. They overlap in the
      // corner square, which is what welds the L together.
      out.push({ p: [sx * ARM_D, ringY, sz * armMid], s: [ARM_W, SLAB, armLen], kind: 'catwalk' });
      out.push({ p: [sx * armMid, ringY, sz * ARM_D], s: [armLen, SLAB, ARM_W], kind: 'catwalk' });

      // Diagonal spoke from the corner of the L in to the balcony.
      const rot = sx * sz > 0 ? 45 : -45;
      out.push({
        p: [sx * 19.0, ringY, sz * 19.0],
        // 4.2 wide, not 5.5. The extra 1.3 m of spoke was overhanging the ramps and the stairs.
        s: [4.2, SLAB, 16.0],
        kind: 'catwalk',
        rot,
      });

      // Railing on the inner edge of each arm.
      //
      // It covers the walkway and stops short of the corner square, where the spoke lands. The
      // first cut railed the full length with a computed opening, and the opening was in the wrong
      // place: the spoke meets the arm at 22.9 m out and the gap was cut at 14.9. Everything built,
      // collided and rendered, and the bake refused to link a single spoke — so the whole mezzanine
      // was reachable only from the two quadrants that happened to have a ramp landing on them.
      //
      // Leaving the corner unrailed is also the honest reading of the shape: the arms are walkways,
      // the corner is a platform.
      //
      // Each railing is opened where an ascent lands. `railing` measures its gaps along its own
      // local run, so the offsets are the landing's world coordinate converted into that run —
      // which is the step the first two cuts of this arena both got wrong, in opposite directions.
      const railMid = (ARM_NEAR + 22.0) / 2;
      const railLen = 22.0 - ARM_NEAR;
      out.push(...railing([sx * (ARM_D - 2.6), MEZZ, sz * railMid], railLen, 90, [sz * (railMid - UP_AT)]));
      out.push(...railing([sx * railMid, MEZZ, sz * (ARM_D - 2.6)], railLen, 0, [-sx * (railMid - UP_AT)]));
    }
  }

  // --- Ways up ------------------------------------------------------------
  //
  // All four run *perpendicular* to the wall, climbing from the field outward onto the inner edge
  // of a bracket arm. The first cut ran them along the wall directly beneath the arm, which built
  // fine, collided fine and was completely unusable: the arm is 5 m above the ramp for its whole
  // length, so every sample on it failed the crouch-headroom probe and the entire mezzanine came
  // out of the bake as a disconnected island. The audit found it as ten unreachable spawns.
  //
  // They also sit at 15.5 m rather than on the diagonal, which is where the spokes are. A ramp
  // passing under a spoke has the same headroom problem in miniature.
  const UP_BOTTOM = 8.0;
  const UP_TOP = 23.5;
  // Two ramps, on the red and blue diagonals.
  out.push({
    p: [-UP_AT, MEZZ / 2 - 0.1, -(UP_BOTTOM + UP_TOP) / 2],
    s: [5.0, 0.5, 16.3],
    kind: 'ramp',
    rot: 0,
    // Positive pitch climbs toward -z here, i.e. outward to the bracket. Negative built a ramp that
    // descended into the floor, which collides and renders perfectly and cannot be walked up.
    pitch: 18,
  });
  out.push({
    p: [UP_AT, MEZZ / 2 - 0.1, (UP_BOTTOM + UP_TOP) / 2],
    s: [5.0, 0.5, 16.3],
    kind: 'ramp',
    rot: 180,
    pitch: 18,
  });
  // ...and two more on the other diagonal, so every quadrant has a way up of its own. The first cut
  // put all four ascents in the red and blue quadrants, which left green and yellow with no route
  // onto their own bracket at all.
  //
  // These were stairs, for variety, and they measured badly in a way worth recording. They linked,
  // they were walkable, and bots still would not use them: a path from the green bracket to the
  // objective came out at 77.6 m going the long way round the building against 39.6 m from the
  // identical position on red's side. Ramps are one continuous surface and stairs are fifteen
  // separate blocks, and the difference is enough to change what A* prefers. Variety in the ways up
  // is worth having, but not on the route a team takes out of its own spawn — that one has to be
  // the same for everybody. The tower spiral, the reactor walkway and the two sky flights carry the
  // variety instead.
  //
  // rot 90, not 270. Pitch tilts about the *yawed* X axis, so the high end is always at -localZ,
  // and rot 270 put it at the middle of the arena instead of at the bracket. That ramp climbed the
  // wrong way and drove its high end up through the balcony slab, which cost the headroom under it
  // and took the upper bridge and both Sky Decks — 201 nodes — off the graph.
  out.push({
    p: [-(UP_BOTTOM + UP_TOP) / 2, MEZZ / 2 - 0.1, UP_AT],
    s: [5.0, 0.5, 16.3],
    kind: 'ramp',
    rot: 90,
    pitch: 18,
  });
  out.push({
    p: [(UP_BOTTOM + UP_TOP) / 2, MEZZ / 2 - 0.1, -UP_AT],
    s: [5.0, 0.5, 16.3],
    kind: 'ramp',
    rot: 270,
    pitch: 18,
  });

  return out;
}

/**
 * Field cover.
 *
 * Authored as one half and rotated 180 degrees, which is what makes the two team approaches
 * provably identical.
 *
 * Sparser than Arena 01 on purpose. That map's maze capped the median sight line at 8.6 m, which is
 * why the bot difficulty ladder collapsed into two tiers — aim error is specified in metres of miss
 * at range, so with nothing to shoot at beyond ten metres `hard` had nowhere to be better than
 * `medium`. The long diagonals here are deliberately left open, and the audit measures what that
 * bought.
 */
const HALF_COVER: Brush[] = [
  { p: [-9.5, 1.1, -14.0], s: [11.0, 2.2, 0.8], kind: 'barrier' },
  { p: [-16.5, 1.1, -8.0], s: [0.8, 2.2, 9.0], kind: 'barrier' },
  { p: [-7.0, 0.55, -21.0], s: [6.0, 1.1, 0.8], kind: 'barrier' },
  { p: [4.5, 0.9, -19.0], s: [3.2, 1.8, 3.2], kind: 'barrier' },
  { p: [12.5, 1.1, -13.0], s: [0.8, 2.2, 8.0], kind: 'barrier' },
  { p: [18.5, 0.55, -19.5], s: [7.0, 1.1, 0.8], kind: 'barrier' },
  { p: [9.5, 2.4, -25.5], s: [1.6, 4.8, 1.6], kind: 'pillar' },
  { p: [-22.0, 0.9, -11.0], s: [3.0, 1.8, 3.0], kind: 'barrier' },
  // Angled cover: nothing else on the field is off-axis, so these read from a long way off.
  { p: [-4.5, 1.0, -8.5], s: [6.5, 2.0, 0.8], kind: 'barrier', rot: 30 },
  { p: [15.5, 1.0, -6.5], s: [6.5, 2.0, 0.8], kind: 'barrier', rot: -35 },
];

const HALF_TRIM: Brush[] = [
  { p: [-9.5, 2.25, -14.0], s: [11.0, 0.12, 0.9], kind: 'trim', glow: 3.0, noCollide: true, noNav: true },
  { p: [-16.5, 2.25, -8.0], s: [0.9, 0.12, 9.0], kind: 'trim', glow: 3.0, noCollide: true, noNav: true },
  { p: [9.5, 4.85, -25.5], s: [1.8, 0.14, 1.8], kind: 'trim', glow: 4.0, noCollide: true, noNav: true },
];

function buildBrushes(): Brush[] {
  const out: Brush[] = [
    ...buildShell(),
    ...buildBowl(),
    ...buildSuites(),
    ...buildBroadcast(),
    ...buildAtrium(),
    ...buildMezzanine(),
    ...buildBroadcastTower(),
    ...buildReactor(),
    ...buildChampionsWalk(),
    ...buildSkyDeck(),
  ];

  for (const b of HALF_COVER) {
    out.push(b, mirror180(b));
  }
  for (const b of HALF_TRIM) {
    out.push(b, mirror180(b));
  }

  return out;
}

function buildSpawns(): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  // Yaw 0 looks down -Z, so to look at the centre from (x, z) the yaw is atan2(x, z). Getting this
  // backwards points every spawn at the wall behind it, which reads as "the arena did not load".
  const facingCentre = (x: number, z: number): number => (Math.atan2(x, z) * 180) / Math.PI;

  const corners: Array<{ team: TeamId; x: number; z: number }> = [
    { team: 'red', x: -25, z: -25 },
    { team: 'blue', x: 25, z: 25 },
    { team: 'green', x: -25, z: 25 },
    { team: 'yellow', x: 25, z: -25 },
  ];
  for (const c of corners) {
    const push = (x: number, y: number, z: number) =>
      spawns.push({ p: [x, y, z], yaw: facingCentre(x, z), team: c.team });
    push(c.x, 0.1, c.z);
    push(c.x + Math.sign(-c.x) * 4.0, 0.1, c.z);
    push(c.x, 0.1, c.z + Math.sign(-c.z) * 4.0);
    // One spawn on the mezzanine corner bracket above each cluster, so a respawning team is not
    // always entering the fight from the floor. 0.98 puts it on the arm rather than out in the void
    // where the first cut of this arena put it.
    push(c.x * 0.98, MEZZ + 0.1, c.z * 0.98);
  }

  const neutral: Array<[number, number, number]> = [
    [0, 0.1, -15],
    [0, 0.1, 15],
    [-22, 0.1, 4],
    [22, 0.1, -4],
    // Clear of the field cover. The first cut put these on the +/-13 diagonals, which is exactly
    // where the long barriers sit, and the spawn resolver relocated all four every match — working
    // as designed, but a spawn authored inside geometry is still an authoring defect. These are the
    // positions the resolver itself chose, so they are known clear, and they keep the 180 degree
    // pairing: (-13.5,-16.5) maps to (13.5,16.5) and (-15,13.5) to (15,-13.5).
    [-13.5, 0.1, -16.5],
    [13.5, 0.1, 16.5],
    [-15, 0.1, 13.5],
    [15, 0.1, -13.5],
    [-25.5, MEZZ + 0.1, -18],
    [25.5, MEZZ + 0.1, 18],
    [18, MEZZ + 0.1, -25.5],
    [-18, MEZZ + 0.1, 25.5],
  ];
  for (const [x, y, z] of neutral) {
    spawns.push({ p: [x, y, z], yaw: facingCentre(x, z), neutral: true });
  }
  return spawns;
}

/**
 * Props.
 *
 * Placement follows one rule, unchanged since Sprint 10: a board must be readable from the space it
 * describes. What is new is that this arena has somewhere to put them — a 12 m wall and a gantry
 * ring, instead of a 9 m wall already full of catwalk.
 */
function buildProps(): PropSpec[] {
  const props: PropSpec[] = [];

  // The four big scoreboards, hung high on each wall above the ribbon board, angled into the field.
  const boards: Array<{ id: string; p: [number, number, number]; rot: number }> = [
    { id: 'scoreboard_north', p: [0, PLAY_TOP - 3.6, -PLAY_HALF + 0.9], rot: 0 },
    { id: 'scoreboard_south', p: [0, PLAY_TOP - 3.6, PLAY_HALF - 0.9], rot: 180 },
    { id: 'scoreboard_west', p: [-PLAY_HALF + 0.9, PLAY_TOP - 3.6, 0], rot: 90 },
    { id: 'scoreboard_east', p: [PLAY_HALF - 0.9, PLAY_TOP - 3.6, 0], rot: -90 },
  ];
  for (const b of boards) {
    props.push({ id: b.id, kind: 'display', p: b.p, s: [14, 3.6, 0.14], rot: b.rot, color: 0x8fefff, text: 'scoreboard' });
  }

  // Elimination feed, at the height a player scans while moving on the mezzanine.
  for (const [id, x, z, rot] of [
    ['feed_west', -PLAY_HALF + 0.9, -14, 90],
    ['feed_east', PLAY_HALF - 0.9, 14, -90],
  ] as Array<[string, number, number, number]>) {
    props.push({ id, kind: 'display', p: [x, 7.4, z], s: [8, 2.1, 0.14], rot, color: 0x8fefff, text: 'killfeed' });
  }

  // Match clock on all four atrium column faces, readable from the field and both bridges.
  for (let i = 0; i < 4; i++) {
    const rot = i * 90 + 45;
    const [x, z] = onCircle(ATRIUM_R + 2.3, rot);
    props.push({ id: `clock_${i}`, kind: 'display', p: [x, 3.6, z], s: [3.6, 1.2, 0.14], rot, color: C_CORE, text: 'clock' });
    props.push({ id: `control_${i}`, kind: 'display', p: [x, 5.1, z], s: [3.6, 1.2, 0.14], rot, color: C_CORE, text: 'objective' });
  }

  // Round status over each spawn approach.
  for (const [id, x, z, rot] of [
    ['status_red', -PLAY_HALF + 0.9, -22, 90],
    ['status_blue', PLAY_HALF - 0.9, 22, -90],
  ] as Array<[string, number, number, number]>) {
    props.push({ id, kind: 'display', p: [x, 4.0, z], s: [7, 1.7, 0.14], rot, color: 0x8fefff, text: 'roundstatus' });
  }

  // Branding. Restrained in colour: never a team colour, because team colour is a reserved channel
  // and a red sponsor board reads as red territory. See VISUAL_STYLE_GUIDE.md.
  const signage: Array<{ id: string; p: [number, number, number]; rot: number; text: string; color: number }> = [
    { id: 'sign_north', p: [0, 3.4, -PLAY_HALF + 0.9], rot: 0, text: 'PHOTON LEAGUE — APEX ARENA', color: 0x8fefff },
    { id: 'sign_south', p: [0, 3.4, PLAY_HALF - 0.9], rot: 180, text: 'CHAMPIONSHIP FINALS — DIVISION ONE', color: 0x8fefff },
    { id: 'sign_walk', p: [-27.4, 5.2, 0], rot: 90, text: "CHAMPION'S WALK · HALL OF THE PHOTON LEAGUE", color: C_AMBER },
    { id: 'sign_east', p: [PLAY_HALF - 0.9, 5.4, -22], rot: -90, text: 'HALCYON OPTICS · VECTOR DYNAMICS · MERIDIAN CELL', color: C_AMBER },
  ];
  for (const s of signage) {
    props.push({ id: s.id, kind: 'display', p: s.p, s: [10, 1.5, 0.14], rot: s.rot, color: s.color, text: s.text });
  }

  // Extraction fans high on the containment wall.
  ([
    [0, 10.2, -PLAY_HALF + 0.8, 0],
    [0, 10.2, PLAY_HALF - 0.8, 0],
    [-PLAY_HALF + 0.8, 10.2, 12, 90],
    [PLAY_HALF - 0.8, 10.2, -12, 90],
  ] as Array<[number, number, number, number]>).forEach(([x, y, z, rot], i) => {
    props.push({ id: `fan_${i}`, kind: 'fan', p: [x, y, z], s: [3.6, 3.6, 0.5], rot, color: 0x4d6070, period: 2.4 + i * 0.3 });
  });

  // Beacons: one on the Core, one on each landmark, one over each team corner.
  const beacons: Array<{ p: [number, number, number]; color: number }> = [
    { p: [0, 13.5, 0], color: 0xffd84d },
    { p: [-20.5, 24.0, -20.5], color: 0xff4d4d },
    { p: [20.5, 11.4, 20.5], color: 0x4dffd8 },
    { p: [-25, 3.6, -25], color: 0xff2d55 },
    { p: [25, 3.6, 25], color: 0x2d7bff },
    { p: [-25, 3.6, 25], color: 0x2dff87 },
    { p: [25, 3.6, -25], color: 0xffd42d },
  ];
  beacons.forEach((b, i) => {
    props.push({ id: `beacon_${i}`, kind: 'warning_light', p: b.p, s: [0.55, 0.55, 0.55], color: b.color, period: 1.8, phase: i / 7 });
  });

  // Energy gates in the atrium doorways: pure light, no collision, but they read as thresholds.
  for (let i = 0; i < 4; i++) {
    const rot = i * 90;
    const [x, z] = onCircle(ATRIUM_R + 7.5, rot);
    props.push({ id: `atrium_gate_${i}`, kind: 'energy_gate', p: [x, 1.6, z], s: [5.5, 3.2, 0.1], rot, color: C_CORE, period: 3.2, phase: i / 4 });
  }

  // Machinery at the reactor's base.
  ([
    [15.0, 1.1, 24.0, 0],
    [25.5, 1.1, 15.5, 90],
    [-15.0, 1.1, -24.0, 0],
  ] as Array<[number, number, number, number]>).forEach(([x, y, z, rot], i) => {
    props.push({ id: `machine_${i}`, kind: 'machine', p: [x, y, z], s: [2.4, 2.4, 1.5], rot, color: 0x39465a, period: 4 + i * 0.5, phase: i / 3 });
  });

  return props;
}

export const ARENA_02_APEX: ArenaDefinition = {
  id: 'arena02_apex',
  name: 'Apex',
  description:
    'Photon League championship venue. Three player levels, a 23 m central atrium, crossed sky bridges and a full spectator bowl.',
  // Play space, not the building. The bowl lives outside this and costs nothing in nav or minimap.
  bounds: [-PLAY_HALF, -PLAY_HALF, PLAY_HALF, PLAY_HALF],
  // Above the sky bridges, below the lowest spectator surface — so the bake never sees the bowl.
  ceilingY: NAV_TOP,
  // Slightly denser than Arena 01. With 28 m of height, aerial perspective is doing real work: it
  // is what makes the truss grid read as *far away* rather than as a pattern on the ceiling.
  fogDensity: 0.0085,
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
    fog: 0x0b1420,
    ambient: 0x3d5c85,
  },
  floorHeights: [0, MEZZ, SKY],
  // Apex builds a real bowl, a real gantry ring and a real truss grid out of brushes, so every
  // procedural equivalent has to be turned off or it gets drawn through the real thing.
  proceduralGalleries: false,
  proceduralCeilingRig: false,
  rigCeilingY: ROOF_Y,
  brushes: buildBrushes(),
  props: buildProps(),
  // Intensities are physical: illuminance is roughly intensity / d². A fixture on the truss grid is
  // 26 m above the field, so it needs far more than one 7 m above a deck — this is why the values
  // here are larger than Arena 01's and not a mistake.
  lights: [
    // Four house fixtures on the truss grid, aimed into the field.
    //
    // Tuned down by half after the first look. Illuminance goes as intensity / d², so a fixture
    // 23 m above the field needs roughly ten times one hanging 7 m over a deck — and the arithmetic
    // says 2600, which blew the whole building to white under bloom and cost the arena every bit of
    // the contrast Sprint 14 bought. The style guide has said since M1 that contrast comes from lit
    // regions against unlit ones, not from raising the floor under everything.
    { p: [-14, TRUSS_Y - 3, -14], color: 0xa8ccff, intensity: 1250, distance: 60 },
    { p: [14, TRUSS_Y - 3, 14], color: 0xa8ccff, intensity: 1250, distance: 60 },
    { p: [-14, TRUSS_Y - 3, 14], color: 0xa8ccff, intensity: 1250, distance: 60 },
    { p: [14, TRUSS_Y - 3, -14], color: 0xa8ccff, intensity: 1250, distance: 60 },
    // The atrium: a bright column of light on the axis, which is what makes the middle the brightest
    // thing in the building and therefore the place the eye goes.
    { p: [0, 14.0, 0], color: 0x8fefff, intensity: 900, distance: 44 },
    { p: [0, 3.0, 0], color: C_CORE, intensity: 190, distance: 22 },
    // Landmarks, each lit in its own key so they are identifiable at distance.
    { p: [-20.5, 7.0, -20.5], color: 0xd8e6ff, intensity: 420, distance: 26 },
    { p: [20.5, 6.0, 20.5], color: 0x6dffd8, intensity: 420, distance: 26 },
    { p: [-25.0, 4.0, 0], color: C_AMBER, intensity: 300, distance: 26, optional: true },
    { p: [25.0, 8.0, 0], color: 0xa8ccff, intensity: 320, distance: 24, optional: true },
    // Team corners.
    { p: [-22, 3.4, -22], color: 0xff6d88, intensity: 300, distance: 26, optional: true },
    { p: [22, 3.4, 22], color: 0x6d9dff, intensity: 300, distance: 26, optional: true },
    { p: [-22, 3.4, 22], color: 0x6dffb0, intensity: 260, distance: 24, optional: true },
    { p: [22, 3.4, -22], color: 0xffe06d, intensity: 260, distance: 24, optional: true },
  ],
  spawns: buildSpawns(),
  objectives: [
    { id: 'central_hill', kind: 'hill', p: [0, 1.4, 0], s: [13, 5, 13] },
    { id: 'flag_red', kind: 'flag', p: [-25, 0.6, -25], s: [1.2, 1.6, 1.2], team: 'red' },
    { id: 'flag_blue', kind: 'flag', p: [25, 0.6, 25], s: [1.2, 1.6, 1.2], team: 'blue' },
    // Domination points on the long diagonal, so holding all three means holding the whole arena.
    { id: 'cap_a', kind: 'capture_point', p: [-17, 0.6, -17], s: [7, 3, 7] },
    { id: 'cap_b', kind: 'capture_point', p: [0, 0.6, 0], s: [7, 3, 7] },
    { id: 'cap_c', kind: 'capture_point', p: [17, 0.6, 17], s: [7, 3, 7] },
  ],
  reverbZones: [
    // The atrium is the wettest space in either arena — a 28 m cylinder should sound like one.
    { p: [0, 6, 0], s: [24, 26, 24], wetness: 0.78, decaySeconds: 2.6 },
    { p: [-25.5, 4, 0], s: [8, 8, 50], wetness: 0.5, decaySeconds: 1.5 },
    { p: [0, 5, 0], s: [84, 28, 84], wetness: 0.38, decaySeconds: 1.5 },
  ],
  teamZones: [
    { team: 'red', p: [-25, 0, -25], radius: 16, label: 'RED SECTOR' },
    { team: 'blue', p: [25, 0, 25], radius: 16, label: 'BLUE SECTOR' },
  ],
  reactiveZones: [{ objectiveId: 'central_hill', p: [0, 0, 0], radius: 13, neutralColor: C_CORE }],
};
