import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { useFloats } from '../observations/useObservations.js'
import { blockLayout } from './blockLayout.js'
import { westStops, westCutForIndex } from './sliceStops.js'

// Argo floats in the same scene as the model volume, at their real lat/lon.
//
// Built in the depth probe's language, not a map-pin language: a shaded sphere
// for the instrument body, a thin flat ring at the waterline the way the probe
// cursor rings its depth, and a hairline stem down the column it profiled.
// No halos and no billboards — a glow reads as decoration, and this marker is
// carrying information (there is an instrument here, it sampled this far down).
//
// The body takes a LIT material so it shades like an object in the scene; an
// unlit one is what made the previous octahedron read as a flat sprite. Depth
// testing stays off, as on the probe, because the block is opaque and a float
// inside the tile would otherwise be buried.
//
// Colours sit in the console palette and deliberately avoid the two that
// already mean something: cyan is the cursor, amber is the pinned point. Idle
// floats are muted steel; the selected one goes to ink white, matching its own
// curve in the comparison chart.

const IDLE = '#84a9c0'
const ON = '#e4ecf7'
const STEM_M = 450             // how far down the stem runs, metres

export default function ObservationMarkers({ dataset, groupRef }) {
  const show = useVisualizationState((s) => s.showArgo)
  const selectedFloatId = useVisualizationState((s) => s.selectedFloatId)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const depthClip = useVisualizationState((s) => s.depthClip)
  const westIndex = useVisualizationState((s) => s.westIndex)
  const floats = useFloats(dataset)
  const scaleRef = useRef([])

  const westCut = westCutForIndex(dataset, westStops(dataset), westIndex)
  const L = blockLayout(dataset, vertExag, depthClip, westCut)
  const { map } = dataset

  const placed = useMemo(
    () => floats.map((f) => ({ f, x: map.lonToX(f.lon), z: map.latToZ(f.lat) })),
    [floats, map],
  )

  // constant on-screen size, as the pin and the probe cursor already do
  useFrame(({ camera }) => {
    for (const g of scaleRef.current) {
      if (!g) continue
      g.scale.setScalar(
        THREE.MathUtils.clamp(camera.position.distanceTo(g.position) / 90, 0.5, 4.5),
      )
    }
  })

  if (!show) return null

  return (
    <group ref={groupRef}>
      {placed.map(({ f, x, z }, i) => {
        const on = f.id === selectedFloatId
        const c = on ? ON : IDLE
        const yTop = L.yOfDepthM(0)
        const yBot = L.yOfDepthM(STEM_M)
        // stem, plus one cross tick at the profile's deepest level — the same
        // device the depth probe uses to show where it stopped
        const r = 1.4
        const stem = new Float32Array([
          x, yTop, z, x, yBot, z,
          x - r, yBot, z, x + r, yBot, z,
          x, yBot, z - r, x, yBot, z + r,
        ])
        return (
          <group key={f.id}>
            <lineSegments raycast={() => null}>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[stem, 3]} />
              </bufferGeometry>
              <lineBasicMaterial
                color={c} transparent opacity={on ? 0.55 : 0.32}
                depthTest={false} depthWrite={false}
              />
            </lineSegments>

            <group ref={(el) => { scaleRef.current[i] = el }} position={[x, yTop, z]}>
              {/* waterline ring — flat, thin, read edge-on as a plane */}
              <mesh rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
                <ringGeometry args={[2.1, on ? 2.9 : 2.6, 32]} />
                <meshBasicMaterial
                  color={c} transparent opacity={on ? 0.9 : 0.6}
                  side={THREE.DoubleSide} depthTest={false} depthWrite={false}
                />
              </mesh>
              {/* the instrument body: LIT, so it shades like a real object */}
              <mesh raycast={() => null}>
                <sphereGeometry args={[1.15, 20, 14]} />
                <meshStandardMaterial
                  color={c} roughness={0.45} metalness={0.15}
                  emissive={c} emissiveIntensity={on ? 0.35 : 0.16}
                  depthTest={false} depthWrite={false}
                />
              </mesh>
              {/* generous invisible hit target — the body is a couple of pixels
                  at normal zoom and would otherwise be unclickable */}
              <mesh userData={{ floatId: f.id }} visible={false}>
                <sphereGeometry args={[5.5, 8, 6]} />
                <meshBasicMaterial />
              </mesh>
            </group>
          </group>
        )
      })}
    </group>
  )
}
