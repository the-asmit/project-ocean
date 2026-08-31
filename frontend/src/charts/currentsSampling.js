// Panel-side sampling of the loaded uo/vo frames.
//
// Reads the SAME Float32Array the streamline tracer walks — one frame, one
// buffer, no second interpolation path. NaN is the mask and is preserved: a
// level below the seafloor reports null rather than a plausible-looking zero,
// because a current profile that quietly reads 0.00 m/s under the bottom is
// worse than one that stops.
//
// DIRECTION CONVENTION: oceanographic, i.e. the direction the water is flowing
// TOWARD (wind is quoted the other way round, which is exactly why this says
// so). u is eastward, v is northward, heading is degrees clockwise from north.

function bilinear(field, meta, level, nx, nz) {
  const { W, D } = meta
  const plane = level * D * W * 2
  const fx = nx * (W - 1)
  const fy = nz * (D - 1)
  if (!(fx >= 0 && fx <= W - 1 && fy >= 0 && fy <= D - 1)) return null
  const i0 = Math.min(W - 2, Math.floor(fx)), tx = fx - i0
  const j0 = Math.min(D - 2, Math.floor(fy)), ty = fy - j0
  let u = 0, v = 0
  for (let dj = 0; dj < 2; dj++) {
    for (let di = 0; di < 2; di++) {
      const o = plane + ((j0 + dj) * W + i0 + di) * 2
      const uu = field[o], vv = field[o + 1]
      if (Number.isNaN(uu) || Number.isNaN(vv)) return null
      const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty)
      u += uu * w; v += vv * w
    }
  }
  return [u, v]
}

const norm = (meta, lat, lon) => [
  (lon - meta.lonMin) / (meta.lonMax - meta.lonMin),
  (lat - meta.latMin) / (meta.latMax - meta.latMin),
]

export function headingDeg(u, v) {
  const d = (Math.atan2(u, v) * 180) / Math.PI
  return d < 0 ? d + 360 : d
}

// 16-point compass, for a readout that a person can act on
const ROSE = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
export const compass = (deg) => ROSE[Math.round(deg / 22.5) % 16]

/** Speed/direction against depth at one lat/lon, over every model level. */
export function sampleCurrentProfile(field, meta, lat, lon) {
  const [nx, nz] = norm(meta, lat, lon)
  const out = []
  for (let k = 0; k < meta.levels; k++) {
    const uv = bilinear(field, meta, k, nx, nz)
    if (!uv) break                       // seafloor or land: the column ends
    const [u, v] = uv
    out.push({
      depth: meta.depthLevels[k],
      speed: Math.hypot(u, v),
      u,
      v,
      dir: headingDeg(u, v),
    })
  }
  return out
}

const R_EARTH_KM = 111.32

/** Speed along the tile's full W->E line at one latitude and one level. */
export function sampleCurrentTransect(field, meta, lat, level, stations = 96) {
  const midLat = (lat * Math.PI) / 180
  const lengthKm = (meta.lonMax - meta.lonMin) * R_EARTH_KM * Math.cos(midLat)
  const rows = []
  for (let i = 0; i < stations; i++) {
    const t = i / (stations - 1)
    const lon = meta.lonMin + t * (meta.lonMax - meta.lonMin)
    const [nx, nz] = norm(meta, lat, lon)
    const uv = bilinear(field, meta, level, nx, nz)
    rows.push({
      km: t * lengthKm,
      lon,
      speed: uv ? Math.hypot(uv[0], uv[1]) : null,
      dir: uv ? headingDeg(uv[0], uv[1]) : null,
      land: !uv,
    })
  }
  return { rows, lengthKm, depthM: meta.depthLevels[level] }
}
