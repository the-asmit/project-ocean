// REAL GLORYS12V1 uo/vo, loaded and traced.
//
// The synthetic spike this replaces proved the animation mechanism; the tracer
// below is the same RK2 scheme with the same seeding and step count, now
// walking measured velocity instead of an invented gyre.
//
// FLOAT32, NOT THE RG8 PATH. The scalar volume is 8-bit because it becomes a
// GPU texture; currents are integrated on the CPU with no shader involved, so
// quantisation would buy nothing and RK2 compounds per-step error over 34
// steps. NaN is preserved as the mask rather than dilate-filled: an invented
// velocity at a coastline would bend a streamline INTO the land instead of
// stopping it, so the tracer has to be able to see the boundary.

const API = '/api'

// Integration step. Arc length scales with the speed of the field, so a fixed
// step gives shorter lines in a slower season: 6000 s drew ~46 km medians on
// the January tile but only ~37 km on the June one. 7400 s restores ~46 km
// there — long enough to read as flow, short enough that the lines do not
// smear the whole basin into one tangle.
export const STEP_SECONDS = 7400
export const STEPS = 34
// Seeds are a jittered square grid, so this is (13 x 13). 420 was far too many:
// at 21 x 21 the spacing between seeds (~19 world units) was SHORTER than the
// lines themselves (~28 units for a 46 km arc), so every line overlapped its
// neighbours and the layer read as stipple rather than flow. At 13 x 13 the
// spacing is ~33 units and each line sits clear of the next.
export const SEEDS = 169

export async function loadCurrents(region, date) {
  const q = `region=${encodeURIComponent(region)}&date=${date}`
  const meta = await fetch(`${API}/currents/meta?${q}`).then(async (r) => {
    if (!r.ok) throw new Error(`/currents/meta -> ${r.status}: ${(await r.text()).slice(0, 160)}`)
    return r.json()
  })
  const frames = await Promise.all(
    meta.dates.map((d) =>
      fetch(`${API}/currents/field?${q}&frame=${d}`)
        .then((r) => {
          if (!r.ok) throw new Error(`/currents/field ${d} -> ${r.status}`)
          return r.arrayBuffer()
        })
        .then((b) => new Float32Array(b)),
    ),
  )
  return { meta, frames }
}

// Bilinear (u, v) at normalised tile position, or null at a masked cell.
// ANY NaN corner returns null — the same all-or-nothing rule the isosurface
// mesher uses, so nothing is ever interpolated across a coastline.
function makeSampler(field, meta, level) {
  const { W, D } = meta
  const plane = level * D * W * 2
  return (nx, nz) => {
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
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Streamlines through one frame at one depth level.
 *
 * Seeds are on a deterministically jittered grid, so a line only moves between
 * frames because the FIELD moved — never because the seed did.
 *
 * @returns { points: Float32Array(seeds*steps*2), live: Uint8Array(seeds) }
 *          in normalised tile coordinates; `live` marks lines that got a valid
 *          sample at their seed, so land does not draw stationary stubs.
 */
export function streamlines(field, meta, level, kmLon, kmLat) {
  const sample = makeSampler(field, meta, level)
  const pts = new Float32Array(SEEDS * STEPS * 2)
  const live = new Uint8Array(SEEDS)
  const cols = Math.ceil(Math.sqrt(SEEDS))
  // metres -> normalised tile fraction, per axis
  const mx = 1 / (kmLon * 1000)
  const mz = 1 / (kmLat * 1000)

  for (let s = 0; s < SEEDS; s++) {
    let x = (s % cols) / (cols - 1) + (hash2(s, 7) - 0.5) * 0.055
    let z = Math.floor(s / cols) / (cols - 1) + (hash2(s, 19) - 0.5) * 0.055
    x = Math.min(1, Math.max(0, x)); z = Math.min(1, Math.max(0, z))
    let w = s * STEPS * 2
    let ok = sample(x, z) !== null
    live[s] = ok ? 1 : 0
    for (let i = 0; i < STEPS; i++) {
      pts[w++] = x; pts[w++] = z
      if (!ok) continue
      // RK2 midpoint, in physical units: velocity is m/s, the step is seconds
      const a = sample(x, z)
      if (!a) { ok = false; continue }
      const hx = x + a[0] * STEP_SECONDS * 0.5 * mx
      const hz = z + a[1] * STEP_SECONDS * 0.5 * mz
      const b = sample(hx, hz)
      if (!b) { ok = false; continue }
      const nx2 = x + b[0] * STEP_SECONDS * mx
      const nz2 = z + b[1] * STEP_SECONDS * mz
      // ran into land or off the tile: hold here, the rest degenerates away
      if (nx2 < 0 || nx2 > 1 || nz2 < 0 || nz2 > 1 || !sample(nx2, nz2)) { ok = false; continue }
      x = nx2; z = nz2
    }
  }
  return { points: pts, live, seeds: SEEDS, steps: STEPS }
}
