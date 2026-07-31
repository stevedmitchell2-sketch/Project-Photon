import { DEG2RAD } from '@/util/math';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { ARENA_01_CLASSIC } from './arena01_classic';
import type { ArenaDefinition, Brush, SurfaceKind } from './MapTypes';

export const ARENAS: Record<string, ArenaDefinition> = {
  [ARENA_01_CLASSIC.id]: ARENA_01_CLASSIC,
};

export const getArena = (id: string): ArenaDefinition => {
  const arena = ARENAS[id];
  if (!arena) throw new Error(`Unknown arena "${id}"`);
  return arena;
};

/**
 * A batch of identically-materialed brushes, ready to become one InstancedMesh.
 * Collapsing the arena to one draw call per surface kind is the single biggest win in the
 * rendering budget — Arena 01 is ~150 brushes across 9 kinds, so 9 draw calls instead of 150.
 */
export interface RenderBatch {
  kind: SurfaceKind;
  color: number;
  glow: number;
  /** Whole batch is excluded from shadow casting (see Brush.noShadow). */
  noShadow: boolean;
  instances: Array<{
    position: [number, number, number];
    scale: [number, number, number];
    rotation: [number, number, number];
    /** Per-instance emissive multiplier, uploaded as an instanced attribute. */
    glow: number;
  }>;
}

export interface BuiltArena {
  definition: ArenaDefinition;
  batches: RenderBatch[];
  colliderHandles: number[];
}

/** Registers every colliding brush with the physics world and groups the rest for rendering. */
export function buildArena(physics: PhysicsWorld, arena: ArenaDefinition): BuiltArena {
  const batchMap = new Map<string, RenderBatch>();
  const colliderHandles: number[] = [];

  for (const brush of arena.brushes) {
    if (!brush.noCollide) {
      colliderHandles.push(addBrushCollider(physics, brush));
    }
    addBrushInstance(batchMap, arena, brush);
  }

  return {
    definition: arena,
    batches: [...batchMap.values()],
    colliderHandles,
  };
}

function addBrushCollider(physics: PhysicsWorld, brush: Brush): number {
  const position = { x: brush.p[0], y: brush.p[1], z: brush.p[2] };
  const size = { x: brush.s[0] / 2, y: brush.s[1] / 2, z: brush.s[2] / 2 };
  if (brush.pitch) {
    return physics.addStaticSlope({
      position,
      size,
      pitch: brush.pitch * DEG2RAD,
      yaw: (brush.rot ?? 0) * DEG2RAD,
      noNav: brush.noNav,
      surface: brush.kind,
    });
  }
  return physics.addStaticBox({
    position,
    size,
    rotationY: (brush.rot ?? 0) * DEG2RAD,
    noNav: brush.noNav,
    surface: brush.kind,
  });
}

function addBrushInstance(
  batchMap: Map<string, RenderBatch>,
  arena: ArenaDefinition,
  brush: Brush,
): void {
  const color = brush.color ?? arena.palette[brush.kind];
  const glow = brush.glow ?? defaultGlow(brush.kind);
  // Glow is part of the key: two brushes of the same kind and colour but different emissive
  // strength cannot share an InstancedMesh, since emissiveIntensity is a material uniform.
  const noShadow = brush.noShadow ?? false;
  const key = `${brush.kind}:${color}:${glow}:${noShadow ? 'ns' : 's'}`;

  let batch = batchMap.get(key);
  if (!batch) {
    batch = { kind: brush.kind, color, glow, noShadow, instances: [] };
    batchMap.set(key, batch);
  }

  batch.instances.push({
    position: [brush.p[0], brush.p[1], brush.p[2]],
    scale: [brush.s[0], brush.s[1], brush.s[2]],
    // YXZ order: yaw applied about world Y, pitch about the yawed X — matches addStaticSlope.
    rotation: [(brush.pitch ?? 0) * DEG2RAD, (brush.rot ?? 0) * DEG2RAD, 0],
    glow,
  });
}

function defaultGlow(kind: SurfaceKind): number {
  switch (kind) {
    case 'led':
      return 2.4;
    case 'trim':
      return 3;
    case 'glass':
      return 0.45;
    case 'catwalk':
      return 0.05;
    default:
      return 0;
  }
}
