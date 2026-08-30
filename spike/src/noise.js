import { createNoise2D, createNoise3D } from 'simplex-noise'

// Deterministic PRNG so the synthetic terrain/field are identical every reload.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(20260830)

export const noise2 = createNoise2D(rng)
export const noise3 = createNoise3D(rng)
