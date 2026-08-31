// ===========================================================================
// ObservationSource — the seam between the app and in-situ observation data.
//
// Nothing above this file knows where a profile came from. Swap the mock for a
// real Argo/GDAC adapter and the markers, the picking and the comparison chart
// keep working unchanged. That is the point of the interface: PS gap #2 (model
// vs observation) can ship its UI now and its data later.
//
//   listFloats({ lonMin, lonMax, latMin, latMax, date })
//        -> Promise<Float[]>
//   getProfile(floatId)
//        -> Promise<{ id, levels: [{ depthM, value }], units, synthetic }>
//
//   Float = {
//     id, label,          // stable id + what to show a human
//     lat, lon,           // real position, degrees
//     date,               // ISO day of the profile
//     platform,           // 'argo' | 'glider' | 'ctd'
//     synthetic,          // TRUE for anything not measured — drives the P3 label
//   }
//
// `synthetic` is not optional and not decoration. A fabricated profile drawn
// next to a model curve is the single most misleading thing this app could
// render, so every consumer is expected to surface it.
// ===========================================================================

import { depthAxis } from '../charts/sampling.js'

// Argo-like sampling: dense through the mixed layer and thermocline, coarser
// below. Real Argo reports on its own pressure levels, so consumers must not
// assume these line up with the model's.
const ARGO_DEPTHS = [
  5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140,
  160, 180, 200, 220, 240, 260, 280, 300, 325, 350, 375, 400, 425, 450,
]

// deterministic PRNG so a region always yields the same floats
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
function hashStr(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// Mock source.
//
// HOW THE "OBSERVED" PROFILE IS MADE, stated plainly: it is the MODEL column at
// the float's position, put through a deterministic distortion — a small
// constant bias, a vertical displacement of the thermocline, and fine noise.
// It is NOT a measurement and carries no information about the real ocean.
//
// It is built this way rather than from a climatology formula because the
// displacement concentrates the divergence where the vertical gradient is
// steepest, which is where model and float genuinely disagree most. That makes
// the comparison UI exercise the same shapes real data will, without pretending
// the numbers mean anything.
// ---------------------------------------------------------------------------
export function mockArgoSource(dataset) {
  const { map, sampler } = dataset
  const { lonMin, lonMax, latMin, latMax } = map
  const maxDataM = dataset.meta.volume.maxDepthM
  const modelLevels = depthAxis(dataset)

  const floatsFor = () => {
    const rand = rng(hashStr(String(dataset.meta.region) + dataset.meta.date))
    const out = []
    let guard = 0
    while (out.length < 6 && guard++ < 400) {
      const lat = latMin + rand() * (latMax - latMin)
      const lon = lonMin + rand() * (lonMax - lonMin)
      const x = map.lonToX(lon)
      const z = map.latToZ(lat)
      // must be in water deep enough to hold a profile worth comparing
      const surf = sampler(x, map.depthToY(modelLevels[0]), z)
      const deep = sampler(x, map.depthToY(200), z)
      if (!surf.valid || !deep.valid) continue
      const n = out.length
      out.push({
        id: `mock-${1900000 + Math.floor(rand() * 99999)}`,
        label: `WMO ${1900000 + n * 137 + Math.floor(rand() * 90)}`,
        lat,
        lon,
        date: dataset.meta.date,
        platform: 'argo',
        synthetic: true,
        // per-float distortion, fixed at creation so a profile never wobbles
        bias: (rand() - 0.5) * 0.8,
        shiftM: (rand() - 0.5) * 50,
        seed: Math.floor(rand() * 1e6),
      })
    }
    return out
  }

  let cache = null
  const all = () => (cache ||= floatsFor())

  return {
    name: 'Mock Argo',
    synthetic: true,

    async listFloats() {
      return all().map(({ bias, shiftM, seed, ...pub }) => pub)
    },

    async getProfile(floatId) {
      const f = all().find((x) => x.id === floatId)
      if (!f) return null
      const x = map.lonToX(f.lon)
      const z = map.latToZ(f.lat)
      const rand = rng(f.seed)
      const levels = []
      for (const depthM of ARGO_DEPTHS) {
        if (depthM > maxDataM) break
        // sample the model at a DISPLACED depth: this is what puts the
        // disagreement on the thermocline rather than spreading it evenly
        const src = Math.max(modelLevels[0], depthM + f.shiftM * Math.exp(-depthM / 220))
        const s = sampler(x, map.depthToY(src), z)
        if (s.value == null) break
        levels.push({
          depthM,
          value: s.value + f.bias + (rand() - 0.5) * 0.12,
        })
      }
      return {
        id: f.id,
        levels,
        units: dataset.meta.volume.units,
        synthetic: true,
        note: 'Derived from the model column by a fixed bias and a thermocline '
          + 'displacement. Not a measurement.',
      }
    },
  }
}
