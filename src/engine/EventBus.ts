/**
 * Typed synchronous event bus.
 *
 * The simulation emits gameplay events (hits, kills, spawns) and never touches presentation.
 * Audio, FX and HUD subscribe. Because dispatch is synchronous and ordered, a replay of the same
 * tick sequence produces the same event sequence — which is what makes killcams and demos possible.
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();
  /** Events emitted during the current tick, drained by presentation once per frame. */
  private queue: Array<{ type: keyof Events; payload: unknown }> = [];

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(type, listener);
  }

  once<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void {
    this.listeners.get(type)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (set) {
      for (const listener of set) (listener as Listener<Events[K]>)(payload);
    }
    this.queue.push({ type, payload });
    // Bound the queue so a paused tab can never grow it without limit.
    if (this.queue.length > 512) this.queue.splice(0, this.queue.length - 512);
  }

  /** Returns and clears everything emitted since the last drain. */
  drain(): Array<{ type: keyof Events; payload: unknown }> {
    if (this.queue.length === 0) return EMPTY;
    const out = this.queue;
    this.queue = [];
    return out;
  }

  clear(): void {
    this.listeners.clear();
    this.queue.length = 0;
  }
}

const EMPTY: Array<{ type: never; payload: unknown }> = [];
