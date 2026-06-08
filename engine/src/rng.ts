/**
 * Deterministic, seedable PRNG (mulberry32). The engine must be a pure function
 * of (state, decisions, config, seed) per §1/§13, so all randomness flows through
 * here — never Math.random. Per-round seeds are derived so each round is
 * independently replayable (§3.3 of the application spec).
 */

export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Box–Muller normal. */
  normal(mean: number, sd: number): number {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  bool(p: number): boolean {
    return this.next() < p;
  }

  /** Inclusive integer in [a, b]. */
  int(a: number, b: number): number {
    return Math.floor(this.uniform(a, b + 1 - 1e-9));
  }
}

/** Combine a base seed with round / salt into a fresh 32-bit seed (splitmix-ish
 *  finalizer) so a given (base, round) always reproduces the same draws. */
export function deriveSeed(base: number, round: number, salt = 0): number {
  let h = (base >>> 0) ^ Math.imul(round + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}
