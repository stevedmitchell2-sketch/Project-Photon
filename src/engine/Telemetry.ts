import type { TeamId } from '@/config/teams';

/**
 * Lightweight, extensible telemetry.
 *
 * Groundwork for Photon Director: a record of what actually happened in a match, structured enough
 * to analyse later without deciding now what the analysis will be.
 *
 * Three properties make it safe to leave switched on:
 *
 *   1. **It never allocates on the hot path when disabled.** `record()` returns immediately, so a
 *      shipped build with telemetry off pays one branch per event.
 *   2. **It is a ring buffer, not a growing list.** A long match cannot exhaust memory.
 *   3. **It is a sink, not a system.** Nothing reads telemetry back to make gameplay decisions —
 *      that would make it part of the simulation and break determinism. It only ever observes.
 *
 * Consumers (a file writer, an HTTP uploader, a live heatmap overlay) attach as sinks. None ship
 * yet; the interface exists so adding one later needs no changes here.
 */

export type TelemetryCategory =
  | 'match'
  | 'combat'
  | 'movement'
  | 'weapon'
  | 'objective'
  | 'ai'
  | 'performance'
  | 'network';

export interface TelemetryEvent {
  /** Simulation tick, so events can be replayed against a snapshot recording. */
  tick: number;
  /** Seconds since match start. */
  time: number;
  category: TelemetryCategory;
  type: string;
  actorId?: number;
  team?: TeamId;
  /** Position, when the event has one — the raw material for heatmaps. */
  x?: number;
  y?: number;
  z?: number;
  /** Event-specific scalar (damage dealt, distance, duration, frame time). */
  value?: number;
  /** Event-specific secondary id (victim, objective, weapon). */
  target?: number | string;
}

export interface TelemetrySink {
  readonly name: string;
  write(events: readonly TelemetryEvent[]): void;
  flush?(): void;
}

/** A 2D occupancy grid over the arena floor. The cheapest useful spatial aggregate. */
export class Heatmap {
  private readonly cells: Float32Array;
  readonly cols: number;
  readonly rows: number;

  constructor(
    private readonly minX: number,
    private readonly minZ: number,
    private readonly maxX: number,
    private readonly maxZ: number,
    private readonly cellSize = 2,
  ) {
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
    this.cells = new Float32Array(this.cols * this.rows);
  }

  add(x: number, z: number, weight = 1): void {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return;
    const col = Math.min(this.cols - 1, Math.floor((x - this.minX) / this.cellSize));
    const row = Math.min(this.rows - 1, Math.floor((z - this.minZ) / this.cellSize));
    this.cells[row * this.cols + col] += weight;
  }

  get(col: number, row: number): number {
    return this.cells[row * this.cols + col] ?? 0;
  }

  /** Normalised copy, for rendering or export. */
  normalised(): Float32Array {
    let peak = 0;
    for (const v of this.cells) if (v > peak) peak = v;
    if (peak <= 0) return new Float32Array(this.cells.length);
    const out = new Float32Array(this.cells.length);
    for (let i = 0; i < this.cells.length; i++) out[i] = this.cells[i] / peak;
    return out;
  }

  /** Hottest cells first — where fights actually happen, for map balance review. */
  hotspots(limit = 10): Array<{ x: number; z: number; weight: number }> {
    const entries: Array<{ x: number; z: number; weight: number }> = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const weight = this.cells[row * this.cols + col];
        if (weight <= 0) continue;
        entries.push({
          x: this.minX + (col + 0.5) * this.cellSize,
          z: this.minZ + (row + 0.5) * this.cellSize,
          weight,
        });
      }
    }
    return entries.sort((a, b) => b.weight - a.weight).slice(0, limit);
  }

  clear(): void {
    this.cells.fill(0);
  }
}

const DEFAULT_CAPACITY = 4096;

export class Telemetry {
  private readonly buffer: TelemetryEvent[] = [];
  private readonly sinks: TelemetrySink[] = [];
  private writeIndex = 0;
  private droppedEvents = 0;

  /** Aggregate counters, cheap enough to keep regardless of buffer pressure. */
  readonly counters = new Map<string, number>();

  /** Spatial aggregates, created on demand by name (deaths, kills, firing positions). */
  readonly heatmaps = new Map<string, Heatmap>();

  enabled = false;

  constructor(readonly capacity = DEFAULT_CAPACITY) {}

  addSink(sink: TelemetrySink): () => void {
    this.sinks.push(sink);
    return () => {
      const i = this.sinks.indexOf(sink);
      if (i >= 0) this.sinks.splice(i, 1);
    };
  }

  createHeatmap(name: string, bounds: [number, number, number, number], cellSize = 2): Heatmap {
    const map = new Heatmap(bounds[0], bounds[1], bounds[2], bounds[3], cellSize);
    this.heatmaps.set(name, map);
    return map;
  }

  /**
   * Records an event. Returns immediately when disabled, so leaving calls in shipped code is free.
   * The event object is copied — callers routinely pass reused scratch objects.
   */
  record(event: TelemetryEvent): void {
    if (!this.enabled) return;

    const key = `${event.category}.${event.type}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);

    if (this.buffer.length < this.capacity) {
      this.buffer.push({ ...event });
    } else {
      // Ring: overwrite oldest. A long match must not grow without bound.
      this.buffer[this.writeIndex] = { ...event };
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.droppedEvents++;
    }
  }

  /** Convenience for positional events, which are the ones heatmaps care about. */
  recordAt(
    event: Omit<TelemetryEvent, 'x' | 'y' | 'z'>,
    position: { x: number; y: number; z: number },
    heatmapName?: string,
  ): void {
    if (!this.enabled) return;
    this.record({ ...event, x: position.x, y: position.y, z: position.z });
    if (heatmapName) this.heatmaps.get(heatmapName)?.add(position.x, position.z);
  }

  count(category: TelemetryCategory, type: string): number {
    return this.counters.get(`${category}.${type}`) ?? 0;
  }

  /** Events in insertion order, oldest first, accounting for ring wraparound. */
  events(): TelemetryEvent[] {
    if (this.buffer.length < this.capacity) return [...this.buffer];
    return [...this.buffer.slice(this.writeIndex), ...this.buffer.slice(0, this.writeIndex)];
  }

  /** Hands buffered events to every sink and clears the buffer. */
  flush(): void {
    if (this.buffer.length === 0) return;
    const events = this.events();
    for (const sink of this.sinks) {
      sink.write(events);
      sink.flush?.();
    }
    this.buffer.length = 0;
    this.writeIndex = 0;
  }

  /** Compact summary — what a match report or a Director prompt would actually consume. */
  summary(): {
    totalEvents: number;
    droppedEvents: number;
    counters: Record<string, number>;
    hotspots: Record<string, Array<{ x: number; z: number; weight: number }>>;
  } {
    const hotspots: Record<string, Array<{ x: number; z: number; weight: number }>> = {};
    for (const [name, map] of this.heatmaps) hotspots[name] = map.hotspots(5);
    return {
      totalEvents: this.buffer.length,
      droppedEvents: this.droppedEvents,
      counters: Object.fromEntries(this.counters),
      hotspots,
    };
  }

  reset(): void {
    this.buffer.length = 0;
    this.writeIndex = 0;
    this.droppedEvents = 0;
    this.counters.clear();
    for (const map of this.heatmaps.values()) map.clear();
  }
}

/** In-memory sink, useful in tests and as a reference implementation for a real one. */
export class MemorySink implements TelemetrySink {
  readonly name = 'memory';
  readonly received: TelemetryEvent[] = [];

  write(events: readonly TelemetryEvent[]): void {
    this.received.push(...events);
  }
}
