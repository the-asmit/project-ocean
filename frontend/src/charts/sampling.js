// Chart data comes from the SAME CPU sampler the hover HUD uses, which walks
// the same RG8 volume the shader renders. No second interpolation path, no
// stub data — if a chart shows a number, that number is in the volume.

const R_EARTH_KM = 111.32

// Bilinear seafloor depth (metres, positive down) at a world x/z.
// NaN where the cell is land — charts must render that as a gap, not as zero.
export function makeSeafloorAt(dataset) {
  const { bathyW: W, bathyD: D } = dataset.meta.bathymetry
  const bathy = dataset.bathy
  const { map } = dataset
  return (x, z) => {
    const u = Math.min(W - 1, Math.max(0, (x / map.spanX + 0.5) * (W - 1)))
    const v = Math.min(D - 1, Math.max(0, (z / map.spanZ + 0.5) * (D - 1)))
    const i0 = Math.min(W - 2, Math.floor(u)), tx = u - i0
    const j0 = Math.min(D - 2, Math.floor(v)), tz = v - j0
    let acc = 0, wsum = 0
    for (let dj = 0; dj < 2; dj++) {
      for (let di = 0; di < 2; di++) {
        const val = bathy[(j0 + dj) * W + i0 + di]
        if (Number.isNaN(val)) continue          // land contributes nothing
        const wt = (di ? tx : 1 - tx) * (dj ? tz : 1 - tz)
        acc += val * wt; wsum += wt
      }
    }
    if (wsum < 0.5) return NaN                   // majority land -> no seafloor
    return map.yToDepth(acc / wsum)
  }
}

// The depth axis the charts sample on: the real GLORYS levels, so a curve
// through them has a knot exactly where the model has data.
export function depthAxis(dataset) {
  return dataset.meta.volume.depthLevels.slice(0, dataset.meta.volume.levelsReal)
}

// --- vertical profile at one lat/lon ------------------------------------
export function sampleProfile(dataset, lat, lon) {
  const { map, sampler } = dataset
  const x = map.lonToX(lon)
  const z = map.latToZ(lat)
  const out = []
  for (const d of depthAxis(dataset)) {
    const s = sampler(x, map.depthToY(d), z)
    if (s.value == null) break                   // seafloor or land: stop here
    out.push({ depth: d, value: s.value })
  }
  return out
}

// --- west->east section at one latitude ---------------------------------
// Returns stations with their full column, plus distance along the section.
export function sampleTransect(dataset, lat, stations = 68) {
  const { map, sampler } = dataset
  const { lonMin, lonMax } = map
  const z = map.latToZ(lat)
  const seafloorAt = makeSeafloorAt(dataset)
  const levels = depthAxis(dataset)
  const kmPerDeg = R_EARTH_KM * Math.cos((lat * Math.PI) / 180)

  const rows = []
  for (let i = 0; i < stations; i++) {
    const t = i / (stations - 1)
    const lon = lonMin + t * (lonMax - lonMin)
    const x = map.lonToX(lon)
    const column = levels.map((d) => {
      const s = sampler(x, map.depthToY(d), z)
      return s.value
    })
    const floor = seafloorAt(x, z)
    rows.push({
      km: t * (lonMax - lonMin) * kmPerDeg,
      lon,
      column,
      seafloor: Number.isNaN(floor) ? null : floor,
      land: Number.isNaN(floor),
    })
  }
  return { rows, levels, lengthKm: (lonMax - lonMin) * kmPerDeg }
}

// Depth of an isotherm along the section: for each station, the shallowest
// depth where the column crosses `value`, linearly interpolated between the two
// bracketing model levels. Null where the column never crosses it.
export function isothermDepths({ rows, levels }, value) {
  return rows.map((r) => {
    const c = r.column
    for (let k = 0; k < c.length - 1; k++) {
      const a = c[k], b = c[k + 1]
      if (a == null || b == null) break
      if ((a - value) * (b - value) <= 0 && a !== b) {
        const f = (a - value) / (a - b)
        return levels[k] + f * (levels[k + 1] - levels[k])
      }
    }
    return null
  })
}

// Evenly spaced isotherm values inside the range the section actually contains.
export function isothermValues({ rows }, interval) {
  let lo = Infinity, hi = -Infinity
  for (const r of rows) {
    for (const v of r.column) {
      if (v == null) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!Number.isFinite(lo)) return []
  const out = []
  for (let v = Math.ceil(lo / interval) * interval; v <= hi; v += interval) {
    out.push(Math.round(v * 100) / 100)
  }
  return out
}

// The shader's transfer() stops, so a chart colour and a voxel colour for the
// same value agree. If transfer() changes, change this.
const STOPS = [
  [8, 26, 107], [26, 140, 217], [89, 209, 140], [250, 217, 77], [235, 64, 38],
]
export function rampColor(t) {
  const u = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(u))
  const f = u - i
  const c = STOPS[i].map((a, k) => Math.round(a + (STOPS[i + 1][k] - a) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
export const RAMP_CSS = `linear-gradient(to top, ${STOPS.map((c) => `rgb(${c.join(',')})`).join(', ')})`
