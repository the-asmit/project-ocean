import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import VolumeRaymarch from './VolumeRaymarch.jsx'
import BathymetryTerrain from './BathymetryTerrain.jsx'
import FreeFlyCamera from './FreeFlyCamera.jsx'
import PointSelection from '../interaction/PointSelection.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'

const BG = '#05070d'

// Small additive marker on the picked point. Additive only — it brightens the
// point, it never darkens the rest of the scene.
function PickMarker({ point, color, pulse }) {
  const ref = useRef()
  useFrame(({ clock, camera }) => {
    const g = ref.current
    if (!g) return
    // keep roughly constant screen size — a fixed world-size sphere blows out
    // and fills the viewport when you fly close to the seafloor
    const d = camera.position.distanceTo(g.position)
    const s = THREE.MathUtils.clamp(d / 34, 0.3, 3.5)
      * (pulse ? 1 + Math.sin(clock.elapsedTime * 3.4) * 0.16 : 1)
    g.scale.setScalar(s)
  })
  if (!point) return null
  return (
    <group ref={ref} position={point.world}>
      <mesh>
        <sphereGeometry args={[0.42, 16, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.85}
          blending={THREE.AdditiveBlending} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.95, 16, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.14}
          blending={THREE.AdditiveBlending} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

// Owns the camera pose: publishes it to cameraRef, aims it on mount, and
// re-applies the home pose whenever homeNonce ticks. FreeFlyCamera re-reads
// yaw/pitch off the quaternion on the same nonce (it renders after this).
function CameraBridge({ cameraRef }) {
  const { camera } = useThree()
  const homePose = useVisualizationState((s) => s.homePose)
  const homeNonce = useVisualizationState((s) => s.homeNonce)

  useEffect(() => {
    cameraRef.current = camera
    if (import.meta.env.DEV) window.__oceanCamera = camera   // dev-only probe
  }, [camera, cameraRef])

  useEffect(() => {
    const { position, target } = homePose
    camera.position.set(position[0], position[1], position[2])
    camera.lookAt(target[0], target[1], target[2])
    camera.updateProjectionMatrix()
  }, [camera, homePose, homeNonce])

  return null
}

export default function OceanScene({ dataset, cameraRef }) {
  const navMode = useVisualizationState((s) => s.navMode)
  const hover = useVisualizationState((s) => s.hover)
  const selected = useVisualizationState((s) => s.selected)
  const homePose = useVisualizationState((s) => s.homePose)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const terrainRef = useRef()

  const { boxSpan, boxDepth } = dataset.meta.bathymetry
  const half = boxSpan / 2

  // Bilinear lookup of the REAL seafloor at any x/z, so the flight envelope can
  // follow the terrain instead of using one flat number. Land cells (NaN) read
  // as just above the surface, so you fly over the island rather than into it.
  const floorAt = useMemo(() => {
    const W = dataset.meta.bathymetry.bathyW
    const D = dataset.meta.bathymetry.bathyD
    const bathy = dataset.bathy
    const g = (i, j) => {
      const v = bathy[j * W + i]
      return Number.isNaN(v) ? 0.25 : v
    }
    return (x, z) => {
      const u = THREE.MathUtils.clamp(x / boxSpan + 0.5, 0, 1) * (W - 1)
      const v = THREE.MathUtils.clamp(z / boxSpan + 0.5, 0, 1) * (D - 1)
      const i0 = Math.min(W - 2, Math.floor(u)), tx = u - i0
      const j0 = Math.min(D - 2, Math.floor(v)), tz = v - j0
      return (
        (g(i0, j0) * (1 - tx) + g(i0 + 1, j0) * tx) * (1 - tz) +
        (g(i0, j0 + 1) * (1 - tx) + g(i0 + 1, j0 + 1) * tx) * tz
      )
    }
  }, [dataset, boxSpan])

  // Flight envelope, tied to the REAL tile.
  // Horizontal: held 30 units inside the tile edge — sitting exactly ON the edge
  // faces you into nothing, so the margin keeps terrain in frame even looking
  // straight outward (fog reaches ~50% at ~63 units).
  // Vertical: ceiling just above the sea surface; FLOOR FOLLOWS THE SEAFLOOR, so
  // you can never end up underneath the terrain staring at black.
  const bounds = {
    half: half - 30,
    ceil: 4,
    floorAt,
    floorClearance: 3.2,   // enough standoff that terrain never fills the frame
    vertExag,
  }

  return (
    <Canvas
      camera={{ position: homePose.position, fov: 60, near: 0.08, far: 900 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      dpr={[1, 1.75]}
    >
      <CameraBridge cameraRef={cameraRef} />
      <color attach="background" args={[BG]} />
      {/* exponential fog in the background colour — far falloff only, near view
          stays clear. Tuned in the spike; do not raise without re-checking the
          "open and breathable" look. */}
      <fogExp2 attach="fog" args={[BG, 0.011]} />

      <ambientLight intensity={0.55} />
      <directionalLight position={[40, 60, 20]} intensity={1.15} />

      <BathymetryTerrain dataset={dataset} meshRef={terrainRef} />
      <VolumeRaymarch dataset={dataset} />

      <PickMarker point={hover} color="#58d4ff" pulse={false} />
      <PickMarker point={selected} color="#ffcf7a" pulse />

      <PointSelection dataset={dataset} terrainRef={terrainRef} />

      <FreeFlyCamera enabled={navMode === 'fly'} bounds={bounds} />
      {navMode === 'orbit' && (
        <OrbitControls
          target={homePose.target}
          minDistance={3}
          maxDistance={260}
          maxPolarAngle={Math.PI * 0.92}
          makeDefault
        />
      )}
    </Canvas>
  )
}
