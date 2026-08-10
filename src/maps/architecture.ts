import type { ArenaDefinition, Brush } from './MapTypes';

/**
 * Procedural architectural detailing.
 *
 * ## What this is for
 *
 * The arena reads as "box, strip light, box" because every brush presents a bare face. A bare face
 * has no internal hierarchy, so the eye has nothing to measure it against and a 1.9 m panel and a
 * 26 m pillar look like the same slab at different distances. No amount of material or lighting work
 * fixes that, because the missing information is *architectural*, not shaded: real construction has
 * framing, bays, a base, a top, and service equipment at human scale.
 *
 * So rather than hand-authoring hundreds more brushes into the arena files, this reads the arena that
 * already exists and derives a detail layer from it. Apex is a curved venue assembled from ~1.9 m arc
 * segments, which means the bay structure is *already there* — it simply is not expressed. This pass
 * expresses it.
 *
 * ## Why it is generated rather than authored
 *
 * Two reasons. Placement stays correct when the arena changes, because it is derived from the brushes
 * rather than duplicated alongside them; and the result is intentional repetition rather than random
 * decoration, which is the difference between architecture and greebles. The kit is small on purpose:
 * mullion, header, kick plate, plinth, collar, louvre, hatch. A handful of modules used consistently
 * reads as a designed building. Fifty modules used once each reads as clutter.
 *
 * ## Constraints
 *
 * Everything emitted is `noCollide` and `noNav`, so the simulation, navigation and every existing
 * spawn and bot path are untouched — this pass cannot change gameplay, only what gameplay looks like.
 * Everything is emitted as ordinary brushes, so it flows through the same instanced batching: the
 * cost is instances and triangles, not draw calls.
 *
 * Placement is deterministic. Variation comes from a hash of the quantised position, never from
 * `Math.random`, so every client sees the same building and captures are reproducible frame to frame.
 */

/** Module dimensions, in metres. Tuned against the 1.92 m x 5 m bay Apex is actually built from. */
const KIT = {
  /** Vertical framing at each bay edge. */
  mullionWidth: 0.14,
  mullionDepth: 0.09,
  /** Horizontal capping at the top of a bay. */
  headerHeight: 0.18,
  headerDepth: 0.11,
  /** Floor-to-wall transition. The single cheapest cue that a wall meets a floor by design. */
  kickHeight: 0.22,
  kickDepth: 0.13,
  /** Recessed panel infill, proud of the wall but inside the framing. */
  panelInset: 0.16,
  panelDepth: 0.035,
  /** Service louvre. */
  ventWidth: 0.62,
  ventHeight: 0.44,
  ventDepth: 0.07,
  /** Pillar base and service collar. */
  plinthHeight: 0.34,
  plinthSpread: 0.17,
  collarHeight: 0.2,
  collarSpread: 0.09,
  /** Human-scale height for the service collar — read from standing eye level, not from the ceiling. */
  collarY: 2.55,
} as const;

/** Selection thresholds. Derived from a census of the live arena, not guessed. */
const SELECT = {
  /** Beyond this radius is the outer shell: unlit, never approached, not worth the instances. */
  maxRadius: 30,
  /** Below this height a "wall" is a ledge or kerb, and framing it looks like a mistake. */
  minWallHeight: 1.8,
  /** Above this is containment geometry — the 28 m shell and the ceiling slab. */
  maxWallHeight: 14,
  /** A wall thicker than this is a mass, not a panel. */
  maxWallThickness: 2.2,
  /** Pillars only get a plinth if they actually meet the floor. */
  floorContact: 1.0,
  minPillarHeight: 2.5,
} as const;

/** Deterministic hash of a quantised position. Same building on every client, every run. */
function hash(x: number, y: number, z: number): number {
  const n = Math.imul(Math.round(x * 16) | 0, 73856093) ^
    Math.imul(Math.round(y * 16) | 0, 19349663) ^
    Math.imul(Math.round(z * 16) | 0, 83492791);
  return ((n >>> 0) % 1000) / 1000;
}

/** Rotates a brush-local offset into world space. Arc segments carry arbitrary yaw. */
function place(
  brush: Brush,
  local: [number, number, number],
): [number, number, number] {
  const yaw = ((brush.rot ?? 0) * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Three.js Y-rotation: x' = x cos + z sin, z' = -x sin + z cos.
  return [
    brush.p[0] + local[0] * c + local[2] * s,
    brush.p[1] + local[1],
    brush.p[2] - local[0] * s + local[2] * c,
  ];
}

/** A decorative module: no collision, no navigation, and never a shadow caster. */
function module_(
  brush: Brush,
  local: [number, number, number],
  size: [number, number, number],
  kind: Brush['kind'],
  extra?: Partial<Brush>,
): Brush {
  return {
    p: place(brush, local),
    s: size,
    kind,
    rot: brush.rot,
    noCollide: true,
    noNav: true,
    // Detail modules sit flush against surfaces that already cast. Letting a few hundred 0.1 m
    // slivers into the shadow pass costs a shadow-map redraw each and buys nothing readable.
    noShadow: true,
    ...extra,
  };
}

/**
 * Detail one wall segment: framing at the bay edges, a header, a kick plate, and a recessed infill.
 *
 * The face treated is the one pointing at the arena centre. Detailing the outward face would double
 * the instance count to decorate surfaces nobody can stand in front of.
 */
function detailWall(brush: Brush, out: Brush[]): void {
  const [sx, sy, sz] = brush.s;
  // Local X is the long axis and local Z the thin one for every wall in the arena; guard anyway.
  if (sz > sx) return;
  const halfThick = sz / 2;

  // Which way is inward? The wall's local +Z in world space, tested against the vector to the centre.
  const yaw = ((brush.rot ?? 0) * Math.PI) / 180;
  const normalX = Math.sin(yaw);
  const normalZ = Math.cos(yaw);
  const towardCentre = -(brush.p[0] * normalX + brush.p[2] * normalZ);
  const facing = towardCentre >= 0 ? 1 : -1;

  const at = (depth: number) => facing * (halfThick + depth / 2);
  const bottom = -sy / 2;

  // Bay framing: a mullion at each edge of the segment.
  for (const side of [-1, 1] as const) {
    out.push(
      module_(
        brush,
        [side * (sx / 2 - KIT.mullionWidth / 2), 0, at(KIT.mullionDepth)],
        [KIT.mullionWidth, sy, KIT.mullionDepth],
        'frame',
      ),
    );
  }

  // Header and kick plate: the bay's top and base.
  out.push(
    module_(
      brush,
      [0, sy / 2 - KIT.headerHeight / 2, at(KIT.headerDepth)],
      [sx, KIT.headerHeight, KIT.headerDepth],
      'frame',
    ),
  );
  out.push(
    module_(
      brush,
      [0, bottom + KIT.kickHeight / 2, at(KIT.kickDepth)],
      [sx, KIT.kickHeight, KIT.kickDepth],
      'frame',
    ),
  );

  // Infill panel, inside the framing and slightly proud, so the bay has a floor of its own.
  const infillH = sy - KIT.kickHeight - KIT.headerHeight - KIT.panelInset;
  if (infillH > 0.5) {
    out.push(
      module_(
        brush,
        [
          0,
          bottom + KIT.kickHeight + infillH / 2,
          at(KIT.panelDepth),
        ],
        [Math.max(0.2, sx - KIT.mullionWidth * 2 - KIT.panelInset), infillH, KIT.panelDepth],
        'wall',
        { color: 0x2c3542 },
      ),
    );
  }

  // A recessed light channel in a minority of bays. This is the cyan the arena is supposed to have:
  // integrated into the framing, explaining itself as a fixture, and rare enough to mean something —
  // as opposed to an outline traced around every edge in the venue, which is what it replaces.
  if (sy > 3.4 && hash(brush.p[2], brush.p[0], brush.p[1]) < 0.34) {
    out.push(
      module_(
        brush,
        [0, bottom + sy - KIT.headerHeight - 0.16, at(0.05)],
        [Math.max(0.2, sx - KIT.mullionWidth * 2 - 0.3), 0.07, 0.05],
        'led',
        { glow: 1.1 },
      ),
    );
  }

  // Service equipment on roughly one bay in four, placed by hash so the pattern is irregular but
  // fixed. Every bay carrying a vent looks like a machine; none looks like a film set.
  const roll = hash(brush.p[0], brush.p[1], brush.p[2]);
  if (roll < 0.16 && sy > 2.6) {
    out.push(
      module_(
        brush,
        [0, bottom + 1.15, at(KIT.ventDepth)],
        [KIT.ventWidth, KIT.ventHeight, KIT.ventDepth],
        'vent',
      ),
    );
  } else if (roll > 0.90 && sy > 2.6) {
    // Access hatch: taller, narrower, and framed differently from a louvre.
    out.push(
      module_(
        brush,
        [0, bottom + 1.0, at(KIT.ventDepth)],
        [0.52, 1.5, KIT.ventDepth],
        'vent',
      ),
    );
  }
}

/** Detail one pillar: a plinth where it lands, and a service collar at standing height. */
function detailPillar(brush: Brush, out: Brush[]): void {
  const [sx, sy, sz] = brush.s;

  out.push(
    module_(
      brush,
      [0, -sy / 2 + KIT.plinthHeight / 2, 0],
      [sx + KIT.plinthSpread, KIT.plinthHeight, sz + KIT.plinthSpread],
      'frame',
    ),
  );

  // A service collar at standing height was tried here and removed. It is a horizontal plate, and
  // the player's eye is below it, so what actually renders is its *underside* — a bright rotated
  // square floating on the pillar face. Confirmed by A/B: deleting it removed the artefact exactly.
  // Any band at this height has to be read from below, which means chamfered or vertical faces,
  // not a flat soffit.
}

/**
 * Derives the architectural detail layer for an arena.
 *
 * Returns brushes to append; the arena definition itself is never mutated, so the module stays a
 * pure function of the arena and can be diffed, counted and tested.
 */
export function architecturalDetail(arena: ArenaDefinition): Brush[] {
  const out: Brush[] = [];

  for (const brush of arena.brushes) {
    if (brush.noCollide && brush.kind !== 'pillar') continue;
    const radius = Math.hypot(brush.p[0], brush.p[2]);
    if (radius > SELECT.maxRadius) continue;

    const [sx, sy, sz] = brush.s;

    if (brush.kind === 'wall') {
      if (sy < SELECT.minWallHeight || sy > SELECT.maxWallHeight) continue;
      if (Math.min(sx, sz) > SELECT.maxWallThickness) continue;
      // The ceiling slab is filed as a wall; it is 84 m across and has no bay structure to express.
      if (Math.max(sx, sz) > 12) continue;
      detailWall(brush, out);
    } else if (brush.kind === 'pillar') {
      if (sy < SELECT.minPillarHeight) continue;
      if (brush.p[1] - sy / 2 > SELECT.floorContact) continue;
      detailPillar(brush, out);
    }
  }

  return out;
}
