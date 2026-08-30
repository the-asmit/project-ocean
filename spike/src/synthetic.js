// ===========================================================================
// SYNTHETIC DATA — NOT REAL OCEAN DATA.
// ---------------------------------------------------------------------------
// Everything in this file is procedurally generated purely to stress-test the
// raymarching renderer:
//   * the bathymetry is layered simplex noise + a couple of analytic
//     trench/ridge bumps,
//   * the "temperature" field is a hand-rolled analytic vertical profile
//     (warm mixed layer -> thermocline -> cold deep water) with some
//     simplex-noise horizontal structure and one warm-core eddy.
// None of it is physically calibrated. For the real app this gets replaced by
// a GLORYS (temperature) + GEBCO/ETOPO (bathymetry) ingest pipeline.
// ===========================================================================
import * as THREE from 'three'
import { noise2, noise3 } from './noise.js'
import { BOX_MIN, BOX_MAX, FLOOR_MIN, FLOOR_MAX, TEMP_MIN, TEMP_MAX } from './constants.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const clamp01 = (v) => clamp(v, 0, 1)
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

// --- Synthetic seafloor height (world Y) at horizontal position (x, z) --------
// Tuned for the vast (+-120) domain: multi-octave swells for basins, plus a
// ridged-noise term that turns crests into sharp ridges and troughs into
// trenches. Range roughly [-5.8, -0.35].
export function seafloor(x, z) {
  let h = -3.4
  h += 2.2 * noise2(x * 0.016, z * 0.016) // broad basins / rises (~400u)
  h += 1.1 * noise2(x * 0.045, z * 0.045) // regional relief (~140u)
  h += 0.5 * noise2(x * 0.12, z * 0.12) // hills (~50u)
  h += 0.2 * noise2(x * 0.29, z * 0.29) // roughness

  // ridged noise: |noise| folded to a crease -> ridges + trenches
  const ridged = 1.0 - Math.abs(noise2(x * 0.035 + 71.3, z * 0.035 - 53.7))
  h += 1.6 * (ridged * ridged - 0.55)

  return clamp(h, -5.8, -0.35)
}

// --- Synthetic temperature (deg C) at world position (x, y, z) ----------------
// y in [-6, 0]. Warm skin, thermocline drop, cold deep water, + horizontal
// noise + two warm-core eddies. Tuned so structure is visible at 10-40u range.
export function temperature(x, y, z) {
  const depth = -y // 0 at surface -> 6 at bottom

  const surfaceT = 29.0
  const deepT = 5.0
  const thermocline = smoothstep(0.6, 3.4, depth) // 0 near surface -> 1 deep
  let T = surfaceT + (deepT - surfaceT) * thermocline

  // near-isothermal mixed layer: flatten the top ~0.5 units
  T += -1.3 * smoothstep(0.0, 0.5, depth)

  // horizontal structure so the field is not pure horizontal layering
  T += 2.4 * noise3(x * 0.028, y * 0.15, z * 0.028)
  T += 1.1 * noise3(x * 0.085, y * 0.1, z * 0.085)

  // warm-core eddies: strong near the surface, decay with depth
  T += 3.6 * Math.exp(-(((x - 22) ** 2 + (z + 16) ** 2) / 520)) * Math.exp(-depth / 2.3)
  T += 2.6 * Math.exp(-(((x + 33) ** 2 + (z - 24) ** 2) / 430)) * Math.exp(-depth / 2.0)

  return clamp(T, TEMP_MIN, TEMP_MAX)
}

// --- Build the 3D scalar field as a Data3DTexture -----------------------------
// R8 (single channel, unsigned byte) so linear filtering is guaranteed on all
// WebGL2 implementations. 256 quantisation levels across the temperature range
// is plenty for a visual spike; a float/half-float texture would be the move
// for the real app if we need exact values back out.
export function buildFieldTexture() {
  const W = 128
  const H = 48
  const D = 128
  const data = new Uint8Array(W * H * D)
  const spanX = BOX_MAX[0] - BOX_MIN[0]
  const spanY = BOX_MAX[1] - BOX_MIN[1]
  const spanZ = BOX_MAX[2] - BOX_MIN[2]

  let n = 0
  for (let k = 0; k < D; k++) {
    const z = BOX_MIN[2] + ((k + 0.5) / D) * spanZ
    for (let j = 0; j < H; j++) {
      const y = BOX_MIN[1] + ((j + 0.5) / H) * spanY
      for (let i = 0; i < W; i++) {
        const x = BOX_MIN[0] + ((i + 0.5) / W) * spanX
        const t = temperature(x, y, z)
        data[n++] = Math.round(clamp01((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 255)
      }
    }
  }

  const tex = new THREE.Data3DTexture(data, W, H, D)
  tex.format = THREE.RedFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.wrapR = THREE.ClampToEdgeWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return { texture: tex, dims: [W, H, D] }
}

// --- Build the seafloor heightmap as a 2D DataTexture -------------------------
// Sampled in the raymarch shader to discard samples below the seafloor.
export function buildHeightTexture() {
  const N = 512
  const data = new Uint8Array(N * N)
  const spanX = BOX_MAX[0] - BOX_MIN[0]
  const spanZ = BOX_MAX[2] - BOX_MIN[2]

  let n = 0
  for (let k = 0; k < N; k++) {
    const z = BOX_MIN[2] + ((k + 0.5) / N) * spanZ
    for (let i = 0; i < N; i++) {
      const x = BOX_MIN[0] + ((i + 0.5) / N) * spanX
      const h = seafloor(x, z)
      data[n++] = Math.round(clamp01((h - FLOOR_MIN) / (FLOOR_MAX - FLOOR_MIN)) * 255)
    }
  }

  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}
