// ===========================================================================
// SYNTHETIC SEAFLOOR DETAIL  —  *** NOT REAL BATHYMETRY ***          (P3)
// ---------------------------------------------------------------------------
// GLORYS `deptho` is a 1/12° grid: one real sounding every ~9 km (3.9 world
// units here). Anything finer than that does not exist in the data, so a mesh
// built straight off the grid shows flat facets and hard triangle edges.
//
// This module fabricates high-frequency roughness to fill that sub-grid gap.
// It is PURELY DECORATIVE. Rules it obeys so it can never be mistaken for data:
//
//   1. It is a ZERO-MEAN displacement added on top of the real, bicubically
//      interpolated depth. It never replaces or biases a real sounding — the
//      large-scale basin / slope / shelf structure underneath is unchanged.
//   2. Its wavelengths (0.9 – 11 world units) sit at or below the real grid
//      spacing, so it only ever adds detail the data could not resolve.
//   3. Its amplitude is small (default ±0.05 world units ~ a few tens of metres
//      at the shelf) and is tapered to zero near land and in very shallow water,
//      where a real sounding is dense enough to matter and a fake bump would be
//      misleading.
//   4. The UI carries a permanent "synthetic surface detail" tag, and this is
//      restated in FINDINGS.md. Set `?detail=0` to switch it off entirely and
//      see the pure interpolated data.
//
// The real app must either source real high-resolution bathymetry (GEBCO 15")
// or keep a disclosure exactly like this one.
// ===========================================================================
import { createNoise2D } from 'simplex-noise'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// deterministic: identical detail every reload, so screenshots are comparable
const noise2 = createNoise2D(mulberry32(20260830))

// Octaves chosen to read as seafloor texture rather than static: two low
// "ridged" bands give directional ridge/gully structure, two higher fBm bands
// give fine granularity. Frequencies are per world unit.
const OCTAVES = [
  { freq: 0.09, amp: 1.0, ridged: true },
  { freq: 0.21, amp: 0.52, ridged: true },
  { freq: 0.47, amp: 0.26, ridged: false },
  { freq: 1.05, amp: 0.13, ridged: false },
]
const NORM = OCTAVES.reduce((s, o) => s + o.amp, 0)

/**
 * Zero-mean synthetic roughness at world (x, z). Returns roughly [-1, 1].
 * Anisotropic: sampled on a sheared lattice so ridges run in a consistent
 * direction the way real abyssal-hill fabric does, instead of looking like
 * isotropic TV static.
 */
export function detailNoise(x, z) {
  // shear + mild anisotropy -> elongated ridge fabric
  const sx = x * 0.92 + z * 0.18
  const sz = z * 0.62 - x * 0.1
  let sum = 0
  for (const { freq, amp, ridged } of OCTAVES) {
    const n = noise2(sx * freq, sz * freq)
    // ridged: fold the noise into creases, then re-centre so it stays zero-mean
    sum += amp * (ridged ? 1 - 2 * Math.abs(n) : n)
  }
  return sum / NORM
}

/**
 * Amplitude taper. Keeps the fake detail away from places where it would either
 * look wrong or be mistaken for real structure.
 *   depthY   world-Y of the seafloor (0 = surface, -6 = box floor)
 *   landness 0 = open water, 1 = land  (from the real NaN mask)
 */
export function detailAmplitude(depthY, landness) {
  // fade out over land and across the last ~1.5 cells of coastline
  const landFade = Math.max(0, 1 - landness * 2.2)
  // fade out in very shallow water (top ~0.35 world units) — surf zone
  const shallowFade = Math.min(1, Math.max(0, (-depthY - 0.06) / 0.35))
  return landFade * shallowFade
}
