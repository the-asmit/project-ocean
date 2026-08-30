import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { detailNoise, detailAmplitude } from './seafloorDetail.js'

// Terrain mesh — carried over from spike-real-data. Two layers, strictly separate:
//
//   LAYER 1 (authoritative): REAL GLORYS `deptho`, Catmull-Rom bicubic between
//     soundings. C1-continuous, passes exactly through every real sample, so the
//     basin / slope / shelf structure is the data's.
//   LAYER 2 (decorative):    SYNTHETIC sub-grid roughness (seafloorDetail.js).
//     Zero-mean, tapered to zero over land and in the surf zone. Toggleable.
//     Disclosed in the UI per P3 — see SourceNote in App.jsx.
//
// Vertex colour is driven by the REAL depth, never the roughened one, so the
// tint keeps reporting data rather than decoration.

function depthColor(t) {
  const abyss = new THREE.Color(0.010, 0.020, 0.050)
  const navy = new THREE.Color(0.040, 0.110, 0.300)
  const teal = new THREE.Color(0.050, 0.560, 0.560)
  const c = new THREE.Color()
  if (t < 0.55) c.copy(abyss).lerp(navy, t / 0.55)
  else c.copy(navy).lerp(teal, (t - 0.55) / 0.45)
  return c
}
const LAND = new THREE.Color(0.10, 0.12, 0.13)

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

const SEGMENTS = 512
// Measured, not guessed: at 0.05 world units this layer changed 0.37% of pixels
// (invisible). 0.14 is the smallest amplitude that contributes without reading
// as spikes. ~27 m on the shelf, ~190 m on the abyssal plain (depth axis is
// non-linear, so world units are not a constant number of metres).
const DETAIL_SCALE = 0.14

export default function BathymetryTerrain({ dataset, meshRef }) {
  const showDetail = useVisualizationState((s) => s.showDetail)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const localRef = useRef()
  const ref = meshRef || localRef

  const { bathy, meta } = dataset
  const W = meta.bathymetry.bathyW
  const D = meta.bathymetry.bathyD
  const span = meta.bathymetry.boxSpan
  const boxDepth = meta.bathymetry.boxDepth

  const geometry = useMemo(() => {
    // land-filled copy so the bicubic kernel never touches NaN; the separate
    // land field is what actually decides land vs water
    const filled = new Float32Array(W * D)
    const landMask = new Float32Array(W * D)
    for (let i = 0; i < W * D; i++) {
      const v = bathy[i]
      landMask[i] = Number.isNaN(v) ? 1 : 0
      filled[i] = v
    }
    for (let pass = 0; pass < 10; pass++) {
      let changed = false
      const snap = Float32Array.from(filled)
      for (let j = 0; j < D; j++) {
        for (let i = 0; i < W; i++) {
          const n = j * W + i
          if (!Number.isNaN(snap[n])) continue
          let acc = 0, cnt = 0
          for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const ii = i + di, jj = j + dj
            if (ii < 0 || ii >= W || jj < 0 || jj >= D) continue
            const s = snap[jj * W + ii]
            if (!Number.isNaN(s)) { acc += s; cnt++ }
          }
          if (cnt) { filled[n] = acc / cnt; changed = true }
        }
      }
      if (!changed) break
    }
    for (let i = 0; i < W * D; i++) if (Number.isNaN(filled[i])) filled[i] = -boxDepth

    const cl = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v)
    const bicubic = (field, fi, fj) => {
      const i1 = Math.floor(fi), j1 = Math.floor(fj)
      const wx = crWeights(fi - i1), wy = crWeights(fj - j1)
      let out = 0
      for (let m = 0; m < 4; m++) {
        const jj = cl(j1 - 1 + m, D - 1)
        let row = 0
        for (let k = 0; k < 4; k++) row += wx[k] * field[jj * W + cl(i1 - 1 + k, W - 1)]
        out += wy[m] * row
      }
      return out
    }

    const g = new THREE.PlaneGeometry(span, span, SEGMENTS, SEGMENTS)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)

    for (let n = 0; n < pos.count; n++) {
      const x = pos.getX(n)
      const z = pos.getZ(n)
      const fi = THREE.MathUtils.clamp(x / span + 0.5, 0, 1) * (W - 1)
      const fj = THREE.MathUtils.clamp(z / span + 0.5, 0, 1) * (D - 1)

      const realY = bicubic(filled, fi, fj)                        // LAYER 1: real
      const landness = THREE.MathUtils.clamp(bicubic(landMask, fi, fj), 0, 1)

      let y, c
      if (landness > 0.5) {
        y = 0.25
        c = LAND
      } else {
        const amp = showDetail ? DETAIL_SCALE * detailAmplitude(realY, landness) : 0
        y = realY + amp * detailNoise(x, z)                        // LAYER 2: synthetic
        c = depthColor(THREE.MathUtils.clamp((realY + boxDepth) / boxDepth, 0, 1))
      }
      pos.setY(n, y)
      colors[n * 3] = c.r
      colors[n * 3 + 1] = c.g
      colors[n * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeVertexNormals()
    return g
  }, [bathy, W, D, span, boxDepth, showDetail])

  // vertical exaggeration: terrain lives in [-boxDepth, 0], so scaling about
  // y=0 is exactly the same transform the shader applies to its box
  return (
    <mesh ref={ref} geometry={geometry} scale={[1, vertExag, 1]} name="bathymetry">
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
  )
}
