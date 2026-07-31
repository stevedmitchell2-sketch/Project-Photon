/**
 * Seeded RNG. The simulation must never call Math.random(): determinism is what lets the same
 * tick function run on a server and be replayed by a predicting client.
 */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed = 0x9e3779b9) {
    // splitmix64-style expansion of a 32-bit seed into the xoshiro state.
    let x = seed >>> 0;
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
  }

  /** xoshiro128** — fast, good distribution, trivially serializable. */
  nextUint(): number {
    const a = Math.imul(this.s1, 5) >>> 0;
    const r = Math.imul(((a << 7) | (a >>> 25)) >>> 0, 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = ((this.s3 << 11) | (this.s3 >>> 21)) >>> 0;
    return r;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length)];
  }

  /** Symmetric spread, useful for weapon cone and particle scatter. */
  spread(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  /** Snapshot/restore so a rollback can rewind randomness along with everything else. */
  serialize(): [number, number, number, number] {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  deserialize(state: readonly [number, number, number, number]): void {
    this.s0 = state[0];
    this.s1 = state[1];
    this.s2 = state[2];
    this.s3 = state[3];
  }
}
