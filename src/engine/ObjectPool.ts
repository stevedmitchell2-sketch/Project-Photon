/**
 * Fixed-capacity object pool with a dense active list.
 *
 * Projectiles, decals, particle bursts and audio voices all allocate zero garbage at runtime by
 * going through this. Iteration over `active` is cache-friendly and stable within a tick.
 */
export class ObjectPool<T> {
  readonly capacity: number;
  private readonly items: T[] = [];
  private readonly free: T[] = [];
  private readonly activeSet = new Set<T>();
  readonly active: T[] = [];

  constructor(capacity: number, factory: () => T, private readonly reset: (item: T) => void) {
    this.capacity = capacity;
    for (let i = 0; i < capacity; i++) {
      const item = factory();
      this.items.push(item);
      this.free.push(item);
    }
  }

  /** Returns null when exhausted — callers decide whether to steal the oldest or drop. */
  acquire(): T | null {
    const item = this.free.pop();
    if (!item) return null;
    this.reset(item);
    this.activeSet.add(item);
    this.active.push(item);
    return item;
  }

  release(item: T): void {
    if (!this.activeSet.delete(item)) return;
    const idx = this.active.indexOf(item);
    if (idx >= 0) {
      this.active[idx] = this.active[this.active.length - 1];
      this.active.pop();
    }
    this.free.push(item);
  }

  /**
   * Safe in-place removal during iteration: walk backwards and release, or use this helper which
   * compacts the dense array in one pass.
   */
  releaseWhere(predicate: (item: T) => boolean): number {
    let removed = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      if (predicate(item)) {
        this.activeSet.delete(item);
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
        this.free.push(item);
        removed++;
      }
    }
    return removed;
  }

  releaseAll(): void {
    for (const item of this.active) this.free.push(item);
    this.active.length = 0;
    this.activeSet.clear();
  }

  get activeCount(): number {
    return this.active.length;
  }

  get freeCount(): number {
    return this.free.length;
  }

  /** All backing items, active or not — used to build instanced render buffers once at startup. */
  get all(): readonly T[] {
    return this.items;
  }
}
