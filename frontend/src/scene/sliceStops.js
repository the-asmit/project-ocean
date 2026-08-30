import { depthAxis } from '../charts/sampling.js'

// The depths the horizontal slice is allowed to land on.
//
// Inside the model's own extent these are the REAL GLORYS levels, so the cut
// face is a level the model actually carries rather than an interpolation
// between two of them — that is what makes a screenshot of the cut quotable
// ("level 14, 92.3 m") instead of approximately-something.
//
// thetao stops at ~454 m while the block runs to the seafloor, so below the
// last level there is nothing to snap TO. Those stops only exist when the user
// opts in, and they are generated evenly in the same 0.42-curve space the
// block's vertical axis uses, so the slider still moves at a natural rate.

const DEEP_STOPS = 18

export function sliceStops(dataset, extended) {
  const levels = depthAxis(dataset)
  const stops = levels.map((depthM, i) => ({ depthM, level: i + 1, real: true }))
  if (!extended) return stops

  const { boxDepth } = dataset.meta.bathymetry
  const { yToDepth, depthToY } = dataset.map
  // 0.985 is blockLayout's own clamp — never offer a stop it would refuse
  const from = -depthToY(stops[stops.length - 1].depthM) / boxDepth
  const to = 0.985
  for (let i = 1; i <= DEEP_STOPS; i++) {
    const t = from + (to - from) * (i / DEEP_STOPS)
    stops.push({ depthM: yToDepth(-t * boxDepth), level: null, real: false })
  }
  return stops
}

// Slider index (0 = no slice) -> the world Y blockLayout clips at.
export function clipYForIndex(dataset, stops, index) {
  if (index <= 0) return 0
  const s = stops[Math.min(stops.length - 1, index - 1)]
  return dataset.map.depthToY(s.depthM)
}

export function stopAt(stops, index) {
  return index <= 0 ? null : stops[Math.min(stops.length - 1, index - 1)]
}

// --- the west-east cut ---------------------------------------------------
// Same idea one axis over: the horizontal slice snaps to the model's real
// depth levels, so the vertical slice snaps to the model's real longitude
// columns. Every position is a column the field actually carries.
//
// Stops stop short of the far wall — a cut that consumed the whole tile would
// leave no block and no cross-section to read.
const MIN_KEEP = 0.12          // fraction of the tile that must survive the cut

export function westStops(dataset) {
  const { W } = dataset.meta.volume
  const { lonMin, lonMax } = dataset.map
  const usable = Math.floor(W * (1 - MIN_KEEP))
  const out = []
  for (let i = 1; i <= usable; i++) {
    const lon = lonMin + (i / (W - 1)) * (lonMax - lonMin)
    out.push({ lon, col: i, frac: i / (W - 1) })
  }
  return out
}

// Slider index (0 = no cut) -> world units removed from the block's west side.
export function westCutForIndex(dataset, stops, index) {
  if (index <= 0) return 0
  const s = stops[Math.min(stops.length - 1, index - 1)]
  return s.frac * dataset.map.spanX
}
