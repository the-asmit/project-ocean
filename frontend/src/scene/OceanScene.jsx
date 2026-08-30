import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import DioramaBlock from './DioramaBlock.jsx'
import PointSelection from '../interaction/PointSelection.jsx'
import DepthProbe from '../interaction/DepthProbe.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { blockLayout } from './blockLayout.js'

// The diorama sits in space as a display object, so the background is flat and
// there is NO fog — an exponential falloff would dissolve the far edges and
// undo the whole point of a bounded block.
const BG = '#070a10'

// Small additive marker on the picked point. Additive only — it brightens the
// point, it never darkens the rest of the scene.
function PickMarker({ point, color, pulse }) {
  const ref = useRef()
  useFrame(({ clock, camera }) => {
    const g = ref.current
    if (!g) return
    const d = camera.position.distanceTo(g.position)
    const s = THREE.MathUtils.clamp(d / 90, 0.5, 4.5)
      * (pulse ? 1 + Math.sin(clock.elapsedTime * 3.4) * 0.16 : 1)
    g.scale.setScalar(s)
  })
  if (!point) return null
  return (
    <group ref={ref} position={point.world}>
      <mesh>
        <sphereGeometry args={[0.9, 16, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.9}
          blending={THREE.AdditiveBlending} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[2.1, 16, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.16}
          blending={THREE.AdditiveBlending} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  )
}


// Publishes the camera, and re-frames the block whenever homeNonce ticks or the
// block's height changes under the vertical-exaggeration control.
function CameraBridge({ cameraRef, controlsRef, blockCenterY }) {
  const { camera, scene } = useThree()
  const homeOrbit = useVisualizationState((s) => s.homeOrbit)
  const homeNonce = useVisualizationState((s) => s.homeNonce)

  useEffect(() => {
    cameraRef.current = camera
    if (import.meta.env.DEV) { window.__oceanCamera = camera; window.__oceanScene = scene }
  }, [camera, cameraRef])

  useEffect(() => {
    const { az, el, dist } = homeOrbit
    const a = THREE.MathUtils.degToRad(az)
    const e = THREE.MathUtils.degToRad(el)
    camera.position.set(
      dist * Math.sin(a) * Math.cos(e),
      blockCenterY + dist * Math.sin(e),
      dist * Math.cos(a) * Math.cos(e),
    )
    const c = controlsRef.current
    if (c) { c.target.set(0, blockCenterY, 0); c.update() }
    else camera.lookAt(0, blockCenterY, 0)
    camera.updateProjectionMatrix()
  }, [camera, controlsRef, homeOrbit, homeNonce, blockCenterY])

  return null
}

export default function OceanScene({ dataset, cameraRef }) {
  const hover = useVisualizationState((s) => s.hover)
  const selected = useVisualizationState((s) => s.selected)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const depthClip = useVisualizationState((s) => s.depthClip)
  const homeOrbit = useVisualizationState((s) => s.homeOrbit)
  const blockRef = useRef()
  const controlsRef = useRef()

  const L = blockLayout(dataset, vertExag, depthClip)
  const reach = Math.max(L.spanX, L.spanZ)
  const centerY = L.centerY

  return (
    <Canvas
      camera={{ position: [190, 110, 227], fov: 42, near: 1, far: 3000 }}
      gl={{ antialias: true, powerPreference: 'high-performance'  }}
      dpr={[1, 1.75]}
    >
      <CameraBridge cameraRef={cameraRef} controlsRef={controlsRef} blockCenterY={centerY} />
      <color attach="background" args={[BG]} />

      <ambientLight intensity={0.6} />
      <directionalLight position={[80, 140, 60]} intensity={1.05} />

      <DioramaBlock dataset={dataset} meshRef={blockRef} />

      <PickMarker point={hover} color="#4fc3f7" pulse={false} />
      <PickMarker point={selected} color="#ffc46b" pulse />

      <DepthProbe dataset={dataset} />
      <PointSelection dataset={dataset} blockRef={blockRef} />

      {/* Orbit-only: this is a bounded object you walk around, not a space you
          fly through. Free-fly lives on in FreeFlyCamera.jsx for the future
          fullscreen deep-dive. */}
      <OrbitControls
        ref={controlsRef}
        target={[0, centerY, 0]}
        minDistance={reach * 0.42}
        maxDistance={reach * 3.2}
        maxPolarAngle={Math.PI * 0.495}
        enablePan={false}
        rotateSpeed={0.75}
        zoomSpeed={0.8}
        makeDefault
      />
    </Canvas>
  )
}
