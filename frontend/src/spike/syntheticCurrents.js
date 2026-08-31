// SPIKE — a FABRICATED current field. Nothing here is a measurement or a model.
//
// This exists to prove the time-animation mechanism before spending a real
// Copernicus fetch on multiple dates and the uo/vo variables. It is a
// caricature that reads like circulation from across the room and falls apart
// the moment anyone treats it as physics:
//
//   - no forcing, no bathymetry, no coastline, no Coriolis
//   - NOT divergence-free, so it has sources and sinks a real current field
//     cannot have
//   - the depth behaviour is an Ekman-spiral LOOK (amplitude decays, direction
//     rotates) chosen because it is recognisable, not because it is derived
//
// Every consumer must display it as SYNTHETIC. See the disclosure in
// CurrentStreamlines.jsx, DataLayersPanel.jsx and the App footer.
//
// The field is analytic rather than an array: u,v are computed on demand at
// whatever position and time a streamline integrator asks for. That keeps the
// spike to one pure function with no buffers to allocate, upload or free, and
// it means "another time step" costs nothing but a different t.

// Deterministic value noise, same construction as chunkGeometry's — the field
// has to be identical on every re-render or the animation would boil.
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy), b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
function fbm(x, y) {
  return vnoise(x, y) * 0.62 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.38
}

// The three levels the spike draws at. Real GLORYS levels exist near these, but
// these are chosen for visual separation, not to match the model's grid.
export const SPIKE_LEVELS = [
  { depthM: 10, label: '10 m' },
  { depthM: 100, label: '100 m' },
  { depthM: 300, label: '300 m' },
]

export const FRAMES = 24
export const HOURS_PER_FRAME = 3

// Frame index -> the label the scrubber shows. Deliberately a RELATIVE offset,
// never a calendar date: a fabricated date sitting beside the real 2020-01-01
// in the app bar is the one mistake this spike must not make. Swapping in real
// dates later is a change to this function alone.
export function frameLabel(frame) {
  return `T+${String(frame * HOURS_PER_FRAME).padStart(2, '0')}h`
}

/**
 * Velocity at a point, in normalised tile coordinates.
 * @param nx  0..1 west->east across the tile
 * @param nz  0..1 south->north across the tile
 * @param depthM  metres
 * @param t   time in frames
 * @returns [u, v] in tile-fractions per unit time (arbitrary units)
 */
export function sampleUV(nx, nz, depthM, t) {
  // --- gyre: solid-body rotation about the centre, tapered to nothing at the
  // edges so streamlines do not march off the tile
  const cx = nx - 0.5, cz = nz - 0.5
  const r = Math.hypot(cx, cz)
  const taper = Math.max(0, 1 - Math.pow(r / 0.62, 2.2))
  let u = -cz * taper
  let v = cx * taper

  // --- shear: a westward jet band, so the picture is not just a spinning disc
  const jetCentre = 0.34 + 0.06 * Math.sin(t * 0.19)
  const jet = Math.exp(-Math.pow((nz - jetCentre) / 0.1, 2))
  u -= jet * 0.85

  // --- noise: two octaves, advected by t so the pattern evolves rather than
  // merely rotating rigidly
  const s = 4.4
  const px = nx * s - t * 0.045, pz = nz * s + t * 0.021
  u += (fbm(px, pz) - 0.5) * 0.62
  v += (fbm(px + 31.7, pz + 17.3) - 0.5) * 0.62

  // --- depth: amplitude decays and the whole pattern rotates with depth. An
  // Ekman-spiral LOOK. There is no Ekman layer here; nothing was solved.
  const decay = Math.exp(-depthM / 260)
  const twist = (depthM / 100) * 0.44
  const ct = Math.cos(twist), st = Math.sin(twist)
  return [(u * ct - v * st) * decay, (u * st + v * ct) * decay]
}

/**
 * Streamlines through the field at one depth and time.
 *
 * Seeds sit on a jittered grid — a regular one would read as a comb, and the
 * jitter is deterministic so a line does not jump between frames for any reason
 * except the field actually changing.
 *
 * @returns { points: Float32Array(seeds*steps*2), seeds, steps } in normalised
 *          tile coordinates; the caller maps them into world space.
 */
export function streamlines(depthM, t, seeds = 420, steps = 34, dt = 0.0075) {
  const pts = new Float32Array(seeds * steps * 2)
  const cols = Math.ceil(Math.sqrt(seeds))
  let w = 0
  for (let s = 0; s < seeds; s++) {
    const gx = (s % cols) / (cols - 1 || 1)
    const gz = Math.floor(s / cols) / (cols - 1 || 1)
    let x = gx + (hash2(s, 7) - 0.5) * 0.055
    let z = gz + (hash2(s, 19) - 0.5) * 0.055
    for (let i = 0; i < steps; i++) {
      pts[w++] = x
      pts[w++] = z
      // RK2 (midpoint): cheap, and visibly straighter than Euler on the gyre
      const [u1, v1] = sampleUV(x, z, depthM, t)
      const [u2, v2] = sampleUV(x + u1 * dt * 0.5, z + v1 * dt * 0.5, depthM, t)
      x += u2 * dt
      z += v2 * dt
      if (x < 0 || x > 1 || z < 0 || z > 1) {
        // ran off the tile: hold the rest of the line at the last inside point
        // so the buffer stays a fixed size and the tail degenerates to nothing
        const lx = pts[w - 2], lz = pts[w - 1]
        for (let j = i + 1; j < steps; j++) { pts[w++] = lx; pts[w++] = lz }
        break
      }
    }
  }
  return { points: pts, seeds, steps }
}
