import { useMemo } from 'react'
import * as THREE from 'three'
import { BOX_MIN, BOX_MAX, FLOOR_MIN, FLOOR_MAX } from './constants.js'
import { detailNoise, detailAmplitude } from './seafloorDetail.js'

// Terrain mesh for the real-data spike. Two layers, kept strictly separate:
//
//   LAYER 1 (authoritative): REAL GLORYS `deptho`, bicubically (Catmull-Rom)
//     interpolated between soundings. C1-continuous and passes exactly through
//     every real sample, so the basin / slope / shelf structure is the data's.
//
//   LAYER 2 (decorative):    SYNTHETIC sub-grid roughness from seafloorDetail.js
//     — zero-mean, small, tapered off near land. See that file's header (P3).
//     `?detail=0` disables it; `?detail=<n>` scales it.
//
// Land cells (NaN in the real grid) are lifted just above the surface and
// tinted grey so the coastline reads.

function depthColor(t) {
  // t: 0 = deepest, 1 = shallowest
  const abyss = new THREE.Color(0.010, 0.020, 0.050)
  const navy = new THREE.Color(0.040, 0.110, 0.300)
  const teal = new THREE.Color(0.050, 0.560, 0.560)
  const c = new THREE.Color()
  if (t < 0.55) c.copy(abyss).lerp(navy, t / 0.55)
  else c.copy(navy).lerp(teal, (t - 0.55) / 0.45)
  return c
}
const LAND = new THREE.Color(0.10, 0.12, 0.13)

// Catmull-Rom basis weights for parameter t in [0,1].
function crWeights(t) {
  const t2 = t * t
  const t3 = t2 * t
  return [
    0.5 * (-t3 + 2 * t2 - t),
    0.5 * (3 * t3 - 5 * t2 + 2),
    0.5 * (-3 * t3 + 4 * t2 + t),
    0.5 * (t3 - t2),
  ]
}

const SEGMENTS = 512      // mesh subdivision (was 360) — ~0.47 world units/quad
// World units of synthetic roughness (see the P3 note in seafloorDetail.js).
// Measured, not guessed: at 0.05 this layer altered 0.37% of pixels — i.e. it
// was invisible. 0.14 is the smallest value that actually contributes without
// reading as spikes. In metres it is depth-dependent (the depth axis is
// non-linear): ~27 m on the shelf, ~190 m on the abyssal plain.
const DETAIL_SCALE = 0.14

export default function Bathymetry({ bathy, meta }) {
  const { detailGain, segments } = useMemo(() => {
    const qs = new URLSearchParams(window.location.search)
    const d = qs.get('detail')
    const s = parseInt(qs.get('seg'), 10)
    return {
      detailGain: d === null ? 1 : Math.max(0, parseFloat(d) || 0),
      segments: Number.isFinite(s) && s >= 32 ? s : SEGMENTS,
    }
  }, [])

  const geometry = useMemo(() => {
    const W = meta.W // lon columns in the bathy grid
    const D = meta.D // lat rows
    const spanX = BOX_MAX[0] - BOX_MIN[0]
    const spanZ = BOX_MAX[2] - BOX_MIN[2]

    // Land-filled copy so the bicubic kernel never touches NaN, plus a separate
    // 0/1 land field. The land field is what decides land vs water; the filled
    // depths only feed interpolation.
    const filled = new Float32Array(W * D)
    const landMask = new Float32Array(W * D)
    for (let i = 0; i < W * D; i++) {
      const v = bathy[i]
      landMask[i] = Number.isNaN(v) ? 1 : 0
      filled[i] = Number.isNaN(v) ? NaN : v
    }
    // iterative nearest-valid dilation into the land cells
    for (let pass = 0; pass < 10; pass++) {
      let changed = false
      const snapshot = Float32Array.from(filled)
      for (let j = 0; j < D; j++) {
        for (let i = 0; i < W; i++) {
          const n = j * W + i
          if (!Number.isNaN(snapshot[n])) continue
          let acc = 0
          let cnt = 0
          for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const ii = i + di
            const jj = j + dj
            if (ii < 0 || ii >= W || jj < 0 || jj >= D) continue
            const s = snapshot[jj * W + ii]
            if (!Number.isNaN(s)) { acc += s; cnt++ }
          }
          if (cnt) { filled[n] = acc / cnt; changed = true }
        }
      }
      if (!changed) break
    }
    for (let i = 0; i < W * D; i++) if (Number.isNaN(filled[i])) filled[i] = FLOOR_MIN

    const clampi = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v)

    // bicubic (Catmull-Rom) sample of a W x D field at grid coords (fi, fj)
    const bicubic = (field, fi, fj) => {
      const i1 = Math.floor(fi)
      const j1 = Math.floor(fj)
      const wx = crWeights(fi - i1)
      const wy = crWeights(fj - j1)
      let out = 0
      for (let m = 0; m < 4; m++) {
        const jj = clampi(j1 - 1 + m, D - 1)
        let row = 0
        for (let k = 0; k < 4; k++) {
          row += wx[k] * field[jj * W + clampi(i1 - 1 + k, W - 1)]
        }
        out += wy[m] * row
      }
      return out
    }

    const g = new THREE.PlaneGeometry(spanX, spanZ, segments, segments)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)

    for (let n = 0; n < pos.count; n++) {
      const x = pos.getX(n)
      const z = pos.getZ(n)
      const u = THREE.MathUtils.clamp((x - BOX_MIN[0]) / spanX, 0, 1)
      const v = THREE.MathUtils.clamp((z - BOX_MIN[2]) / spanZ, 0, 1)
      const fi = u * (W - 1)
      const fj = v * (D - 1)

      // LAYER 1 — real data, smoothly interpolated
      const realY = bicubic(filled, fi, fj)
      const landness = THREE.MathUtils.clamp(bicubic(landMask, fi, fj), 0, 1)
      const isLand = landness > 0.5

      let y
      let c
      if (isLand) {
        y = 0.25
        c = LAND
      } else {
        // LAYER 2 — synthetic sub-grid roughness (decorative, zero-mean)
        const amp = DETAIL_SCALE * detailGain * detailAmplitude(realY, landness)
        y = realY + amp * detailNoise(x, z)
        // colour from the REAL depth, not the roughened one, so the tint keeps
        // reporting the data rather than the decoration
        const tNorm = THREE.MathUtils.clamp((realY - FLOOR_MIN) / (FLOOR_MAX - FLOOR_MIN), 0, 1)
        c = depthColor(tNorm)
      }
      pos.setY(n, y)
      colors[n * 3 + 0] = c.r
      colors[n * 3 + 1] = c.g
      colors[n * 3 + 2] = c.b
    }

    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeVertexNormals()
    return g
  }, [bathy, meta, detailGain, segments])

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
  )
}
