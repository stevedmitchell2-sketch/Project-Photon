import type { TeamId } from '@/config/teams';

/**
 * Arenas are pure data. The builder turns them into collision, instanced render batches and a
 * navigation graph. The in-game map editor (M6) reads and writes exactly this shape, so anything
 * an arena file can express, the editor can author.
 */

export type SurfaceKind =
  | 'floor'
  | 'wall'
  | 'catwalk'
  | 'barrier'
  | 'pillar'
  | 'ramp'
  | 'glass'
  | 'led'
  | 'trim';

export interface Brush {
  /** Centre position in metres. */
  p: [number, number, number];
  /** Full size in metres (not half-extents — the builder halves it). */
  s: [number, number, number];
  kind: SurfaceKind;
  /** Y rotation in degrees. */
  rot?: number;
  /** Pitch in degrees, for ramps. */
  pitch?: number;
  /** Emissive strength multiplier; drives bloom. */
  glow?: number;
  /** Override colour (hex). Defaults come from the arena palette. */
  color?: number;
  /** Excluded from navigation sampling (e.g. glass you can shoot through but not walk on). */
  noNav?: boolean;
  /** No collision — decorative only. */
  noCollide?: boolean;
  /**
   * Excluded from shadow casting. Essential for containment surfaces: a ceiling spanning the whole
   * arena will otherwise block the key light and leave everything below it in full shadow.
   */
  noShadow?: boolean;
}

export interface LightSpec {
  p: [number, number, number];
  color: number;
  /**
   * Point-light intensity in Three.js physical units. Attenuation is inverse-square, so
   * illuminance at distance d is roughly `intensity / d²` — a fixture meant to read at 10 m needs
   * an intensity around 100, not 10. Values tuned for the pre-r155 legacy lighting model will
   * render almost black.
   */
  intensity: number;
  distance: number;
  /** Marked lights are candidates for culling in Performance Mode. */
  optional?: boolean;
}

export interface SpawnPoint {
  p: [number, number, number];
  /** Facing yaw in degrees. */
  yaw: number;
  team?: TeamId;
  /** Neutral spawns are used by FFA and as overflow. */
  neutral?: boolean;
}

export interface ObjectiveVolume {
  id: string;
  kind: 'hill' | 'flag' | 'capture_point';
  p: [number, number, number];
  s: [number, number, number];
  team?: TeamId;
}

export interface ReverbZone {
  p: [number, number, number];
  s: [number, number, number];
  /** 0 = dry corridor, 1 = cavernous atrium. */
  wetness: number;
  decaySeconds: number;
}

export interface ArenaPalette {
  floor: number;
  wall: number;
  catwalk: number;
  barrier: number;
  pillar: number;
  ramp: number;
  glass: number;
  led: number;
  trim: number;
  fog: number;
  ambient: number;
}

/**
 * Interactive and animated set dressing.
 *
 * Props are data like everything else. The simulation owns their state (a door is open or closed,
 * a gate is charged or venting) so it stays deterministic and replayable; the renderer only reads
 * that state. Purely decorative props carry no simulation state at all and are animated from the
 * render clock, which keeps them off the tick budget.
 */
export type PropKind =
  | 'door' // Slides open when an actor is near. Has a real, moving collider.
  | 'energy_gate' // Emissive curtain; blocks nothing, pulses on a cycle.
  | 'fan' // Rotating blades behind a grille.
  | 'warning_light' // Pulsing beacon with a real point light.
  | 'display' // Electronic sign; can show the match clock or a scrolling message.
  | 'machine'; // Ambient machinery with a slow bob and emissive vents.

export interface PropSpec {
  id: string;
  kind: PropKind;
  p: [number, number, number];
  s: [number, number, number];
  /** Y rotation in degrees. */
  rot?: number;
  color?: number;
  /** Cycle period in seconds for animated props. */
  period?: number;
  /** Phase offset 0..1, so a row of identical props does not animate in lockstep. */
  phase?: number;
  /** Doors: how far the panel slides, in metres, along its local X. */
  travel?: number;
  /** Doors: actors within this radius open it. */
  triggerRadius?: number;
  /** Displays: 'clock' shows the match timer, otherwise the literal text scrolls. */
  text?: string;
}

export interface ArenaDefinition {
  id: string;
  name: string;
  description: string;
  /** Play-space bounds [minX, minZ, maxX, maxZ] — used for the minimap and nav sampling extents. */
  bounds: [number, number, number, number];
  /** Highest walkable Y. Nav sampling rays start above this. */
  ceilingY: number;
  palette: ArenaPalette;
  fogDensity: number;
  brushes: Brush[];
  props: PropSpec[];
  lights: LightSpec[];
  spawns: SpawnPoint[];
  objectives: ObjectiveVolume[];
  reverbZones: ReverbZone[];
  /** Vertical levels for the minimap floor selector. */
  floorHeights: number[];
}
