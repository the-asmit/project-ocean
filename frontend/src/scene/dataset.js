import * as THREE from 'three'

// Loads the backend manifest + binaries and builds both the GPU textures and a
// CPU-side sampler. The sampler is what the hover HUD reads — it walks the SAME
// RG8 buffer the shader samples, honouring the depth LUT and the validity
// channel, so the number on screen is the number being rendered (not a stub and
// not a second, differently-interpolated source).

const API = '/api'

async function bin(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${r.statusText}`)
  return r.arrayBuffer()
}

// --- world <-> geographic mapping ---------------------------------------
// Production build: geography is NOT mirrored (the spike flipped both axes to
// face the camera; that would put lat/lon readouts on the wrong side of the
// tile). x = east, z = north, y = -depth through the shared depth curve.
export function makeMapping(meta) {
  const { lonMin, lonMax, latMin, latMax } = meta.bathymetry
  const span = meta.bathymetry.boxSpan
  const boxDepth = meta.bathymetry.boxDepth
  const bathyMax = meta.bathymetry.bathyMaxM
  const curve = meta.bathymetry.depthCurve
  return {
    span, boxDepth, bathyMax, curve,
    lonMin, lonMax, latMin, latMax,
    xToLon: (x) => lonMin + (x / span + 0.5) * (lonMax - lonMin),
    zToLat: (z) => latMin + (z / span + 0.5) * (latMax - latMin),
    lonToX: (lon) => ((lon - lonMin) / (lonMax - lonMin) - 0.5) * span,
    latToZ: (lat) => ((lat - latMin) / (latMax - latMin) - 0.5) * span,
    // world Y (already un-exaggerated) -> metres
    yToDepth: (y) => bathyMax * Math.pow(Math.min(1, Math.max(0, -y / boxDepth)), 1 / curve),
    depthToY: (m) => -boxDepth * Math.pow(Math.min(1, Math.max(0, m / bathyMax)), curve),
  }
}

// --- CPU sampler over the RG8 volume ------------------------------------
function makeSampler(meta, rg8, map) {
  const { W, H, D, depthLUT, valueMin, valueMax } = meta.volume
  const LUT_N = depthLUT.length

  const at = (i, j, k) => {
    const o = ((k * H + j) * W + i) * 2
    return [rg8[o], rg8[o + 1]]
  }

  // world position -> { value, valid }
  return function sample(x, y, z) {
    const u = (x / map.span + 0.5) * (W - 1)
    const w = (z / map.span + 0.5) * (D - 1)
    if (u < 0 || u > W - 1 || w < 0 || w > D - 1) return { value: null, valid: false }

    // depth: linear box fraction -> LUT -> texture row (mirrors the shader)
    const ynorm = Math.min(1, Math.max(0, -y / map.boxDepth))
    const fi = ynorm * (LUT_N - 1)
    const l0 = Math.min(LUT_N - 1, Math.floor(fi))
    const l1 = Math.min(LUT_N - 1, l0 + 1)
    const rowCoord = depthLUT[l0] + (depthLUT[l1] - depthLUT[l0]) * (fi - l0)
    const v = Math.min(H - 1, Math.max(0, rowCoord * H - 0.5))

    const i0 = Math.min(W - 2, Math.floor(u)), tx = u - i0
    const j0 = Math.min(H - 2, Math.floor(v)), ty = v - j0
    const k0 = Math.min(D - 2, Math.floor(w)), tz = w - k0

    // trilinear over R, weighted by the validity channel so invalid voxels
    // never contribute (same guarantee the shader's `.g < 0.5` gives)
    let acc = 0, wsum = 0
    for (let dk = 0; dk < 2; dk++) {
      for (let dj = 0; dj < 2; dj++) {
        for (let di = 0; di < 2; di++) {
          const [r, g] = at(i0 + di, j0 + dj, k0 + dk)
          if (g < 128) continue
          const wt = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz)
          acc += (r / 255) * wt
          wsum += wt
        }
      }
    }
    if (wsum < 1e-4) return { value: null, valid: false }
    return { value: valueMin + (acc / wsum) * (valueMax - valueMin), valid: true }
  }
}

export async function loadDataset({ region, date, variable }) {
  const q = `region=${region}&date=${date}&variable=${variable}`
  const meta = await fetch(`${API}/dataset?${q}`).then(async (r) => {
    if (!r.ok) throw new Error(`/dataset -> ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return r.json()
  })

  const [fieldBuf, heightBuf, bathyBuf] = await Promise.all([
    bin(`${API}/slice/volume?${q}`),
    bin(`${API}/bathymetry/height?region=${region}`),
    bin(`${API}/bathymetry?region=${region}`),
  ])

  const { W, H, D } = meta.volume
  const rg8 = new Uint8Array(fieldBuf)

  const field = new THREE.Data3DTexture(rg8, W, H, D)
  field.format = THREE.RGFormat
  field.type = THREE.UnsignedByteType
  field.minFilter = THREE.LinearFilter
  field.magFilter = THREE.LinearFilter
  field.wrapS = field.wrapT = field.wrapR = THREE.ClampToEdgeWrapping
  field.unpackAlignment = 1
  field.needsUpdate = true

  const hN = meta.bathymetry.heightN
  const height = new THREE.DataTexture(
    new Uint8Array(heightBuf), hN, hN, THREE.RedFormat, THREE.UnsignedByteType,
  )
  height.minFilter = THREE.LinearFilter
  height.magFilter = THREE.LinearFilter
  height.wrapS = height.wrapT = THREE.ClampToEdgeWrapping
  height.unpackAlignment = 1
  height.needsUpdate = true

  const map = makeMapping(meta)
  return {
    meta,
    field,
    height,
    bathy: new Float32Array(bathyBuf),   // (lat, lon) world-Y, NaN = land
    lut: Float32Array.from(meta.volume.depthLUT),
    map,
    sampler: makeSampler(meta, rg8, map),
  }
}
