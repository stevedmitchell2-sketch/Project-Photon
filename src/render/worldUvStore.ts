/**
 * Which brush kinds use world-scaled UVs, switchable at runtime.
 *
 * A module constant would have been enough to ship, but not enough to *test*. The question the
 * A/B has to answer is what world-scaled UVs cost, and that is only answerable if both conditions
 * share one scene, one camera, one set of lights and one frame — reloading between arms changes
 * shader warm-up, texture residency and which brushes are in frustum, and the previous
 * "237 draws / 36 programs" figure is exactly what that produces: a number compared against a
 * different scene, mistaken for a regression.
 *
 * So the set lives here behind a tiny subscribable store, and `__PHOTON__.worldUv` flips it live.
 */

let kinds = new Set<string>(['wall', 'pillar']);
let version = 0;
const listeners = new Set<() => void>();

export const worldUvStore = {
  has(kind: string): boolean {
    return kinds.has(kind);
  },
  /** Replace the active set and notify every batch to re-apply or tear down. */
  set(next: readonly string[]): string[] {
    kinds = new Set(next);
    version++;
    for (const listener of listeners) listener();
    return [...kinds];
  },
  list(): string[] {
    return [...kinds];
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** `useSyncExternalStore` snapshot. A version counter, because the Set is mutated in place. */
  getSnapshot(): number {
    return version;
  },
};
