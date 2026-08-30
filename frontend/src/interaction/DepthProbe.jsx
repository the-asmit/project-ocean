import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useProbe } from './useProbe.js'

// The pinned water column, drawn INSIDE the block.
//
// The chunk is opaque, so a marker at 200 m would otherwise be buried behind
// solid rock. Everything here draws with depthTest off and additive blending:
// it reads as an instrument overlay laid through the object rather than a
// solid that clips against it. That is what makes the interior reachable —
// the column, its level ticks and the cursor are all visible from any angle,
// through any face.
//
// The column runs the full water depth. The stretch below the variable's own
// extent is drawn dimmer and dashed, because there is no value down there to
// read — the geometry continues, the data does not.

function additive(color, opacity) {
  return (
    <lineBasicMaterial
      color={color} transparent opacity={opacity}
      blending={THREE.AdditiveBlending} depthTest={false} depthWrite={false}
    />
  )
}

export default function DepthProbe({ dataset }) {
  const probe = useProbe(dataset)
  const ref = useRef()
  const maxDataM = dataset.meta.volume.maxDepthM
  const { bathyMaxM } = dataset.meta.bathymetry

  // Scale the cursor with camera distance so it stays readable at any zoom,
  // exactly as the pin marker does.
  useFrame(({ camera }) => {
    const g = ref.current
    if (!g) return
    g.scale.setScalar(
      THREE.MathUtils.clamp(camera.position.distanceTo(g.position) / 90, 0.5, 4.5),
    )
  })

  const geo = useMemo(() => {
    if (!probe) return null
    const { x, z, yOfDepthM, seafloorM, levels } = probe
    const bottomM = Math.min(seafloorM ?? bathyMaxM, bathyMaxM)

    const seg = (fromM, toM) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(
        [x, yOfDepthM(fromM), z, x, yOfDepthM(toM), z], 3,
      ))
      return g
    }
    // level ticks: short cross bars at every real model level, so the column
    // shows the model's own vertical resolution rather than a smooth rod
    const ticks = []
    const r = 1.6
    for (const m of levels) {
      if (m > bottomM) break
      const y = yOfDepthM(m)
      ticks.push(x - r, y, z, x + r, y, z, x, y, z - r, x, y, z + r)
    }
    const tickGeo = new THREE.BufferGeometry()
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3))

    return {
      inData: seg(0, Math.min(maxDataM, bottomM)),
      belowData: bottomM > maxDataM ? seg(maxDataM, bottomM) : null,
      tickGeo,
    }
  }, [probe?.x, probe?.z, probe?.seafloorM, maxDataM, bathyMaxM]) // eslint-disable-line

  if (!probe || !geo) return null
  const dead = !probe.valid

  return (
    <group>
      <lineSegments geometry={geo.inData} raycast={() => null}>
        {additive('#4fc3f7', 0.5)}
      </lineSegments>
      {geo.belowData && (
        <lineSegments geometry={geo.belowData} raycast={() => null}>
          {additive('#43506a', 0.42)}
        </lineSegments>
      )}
      <lineSegments geometry={geo.tickGeo} raycast={() => null}>
        {additive('#4fc3f7', 0.34)}
      </lineSegments>

      <group ref={ref} position={probe.world}>
        {/* the cursor itself: a disc read edge-on as a plane through the column */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.2, 3.1, 28]} />
          <meshBasicMaterial
            color={dead ? '#7c8ea6' : '#ffc46b'} transparent opacity={0.95}
            side={THREE.DoubleSide} blending={THREE.AdditiveBlending}
            depthTest={false} depthWrite={false}
          />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.85, 16, 12]} />
          <meshBasicMaterial
            color={dead ? '#7c8ea6' : '#ffc46b'} transparent opacity={0.95}
            blending={THREE.AdditiveBlending} depthTest={false} depthWrite={false}
          />
        </mesh>
        <mesh>
          <sphereGeometry args={[2.0, 16, 12]} />
          <meshBasicMaterial
            color={dead ? '#7c8ea6' : '#ffc46b'} transparent opacity={0.18}
            blending={THREE.AdditiveBlending} depthTest={false} depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  )
}
