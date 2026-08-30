import * as THREE from 'three'

// Loads the adapter output for one tile and builds the GPU textures.
// All coordinate/format conventions are decided in adapt.py and just honoured here.

async function bin(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.arrayBuffer()
}

export async function loadTile(tile) {
  const base = `data/${tile}_`
  const [meta, fieldBuf, heightBuf, bathyBuf] = await Promise.all([
    fetch(base + 'meta.json').then((r) => r.json()),
    bin(base + 'field.bin'),
    bin(base + 'height.bin'),
    bin(base + 'bathy.bin'),
  ])

  const { W, H, D, heightN } = meta

  // --- 3D field: RG8, R = normalised temperature, G = validity (0/1) ---------
  const field = new THREE.Data3DTexture(new Uint8Array(fieldBuf), W, H, D)
  field.format = THREE.RGFormat
  field.type = THREE.UnsignedByteType
  field.minFilter = THREE.LinearFilter
  field.magFilter = THREE.LinearFilter
  field.wrapS = field.wrapT = field.wrapR = THREE.ClampToEdgeWrapping
  field.unpackAlignment = 1
  field.needsUpdate = true

  // --- depth-remap LUT: 128 floats, uploaded as a uniform array (not a texture)
  const lut = Float32Array.from(meta.depthLUT)

  // --- seafloor height map: N x N, R8 (same role as the spike's) ------------
  const height = new THREE.DataTexture(
    new Uint8Array(heightBuf), heightN, heightN, THREE.RedFormat, THREE.UnsignedByteType,
  )
  height.minFilter = THREE.LinearFilter
  height.magFilter = THREE.LinearFilter
  height.wrapS = height.wrapT = THREE.ClampToEdgeWrapping
  height.unpackAlignment = 1
  height.needsUpdate = true

  // --- native-grid seafloor (world-Y, NaN = land) for the terrain mesh ------
  const bathy = new Float32Array(bathyBuf) // row-major (lat, lon), NaN = land

  return { meta, field, lut, height, bathy }
}
