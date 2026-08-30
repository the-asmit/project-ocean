import { useMemo } from 'react'
import * as THREE from 'three'
import { seafloor } from './synthetic.js'
import { FLOOR_MIN, FLOOR_MAX } from './constants.js'

// Depth tint: shallow teal -> navy -> near-black abyss.
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

export default function Bathymetry() {
  const geometry = useMemo(() => {
    // Vast subdivided plane (matches the +-120 domain), displaced along Y by the
    // synthetic seafloor fn. 400 segments -> ~0.6u spacing, smooth up close.
    const g = new THREE.PlaneGeometry(240, 240, 400, 400)
    g.rotateX(-Math.PI / 2)

    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const h = seafloor(x, z)
      pos.setY(i, h)

      const tNorm = THREE.MathUtils.clamp((h - FLOOR_MIN) / (FLOOR_MAX - FLOOR_MIN), 0, 1)
      const c = depthColor(tNorm)
      colors[i * 3 + 0] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeVertexNormals()
    return g
  }, [])

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
  )
}
