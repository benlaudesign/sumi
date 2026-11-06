// Same generator the editor uses (mulberry32), duplicated here so the
// pipeline stays import-free of app/sumi.tsx. Deterministic: same seed →
// same sequence.
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// One integer seed per (batch, try) pair.
export function trySeed(batchSeed: number, tryIndex: number) {
  return (Math.imul(batchSeed >>> 0, 1000003) + Math.imul(tryIndex + 1, 7919)) >>> 0
}

export type Rng = () => number
export const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]
export const chance = (rng: Rng, p: number) => rng() < p
export const between = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo)
