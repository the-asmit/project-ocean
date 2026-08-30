import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stats } from '@react-three/drei'
import { Leva } from 'leva'
import Bathymetry from './Bathymetry.jsx'
import VolumeRaymarch from './VolumeRaymarch.jsx'

export default function App() {
  const [webgl2, setWebgl2] = useState(true)

  // harness overrides: ?dpr=2 forces a fixed device pixel ratio;
  // ?fog= overrides the FogExp2 density (for the tuning sweep)
  const qs = new URLSearchParams(window.location.search)
  const dpr = qs.has('dpr') ? parseFloat(qs.get('dpr')) : [1, 1.75]
  const fogDensity = qs.has('fog') ? parseFloat(qs.get('fog')) : 0.011

  return (
    <>
      <Leva collapsed={false} />

      <div className="hud">
        <b>Ocean-Viz — raymarch spike</b>
        <br />
        SYNTHETIC data. Volumetric raymarch of a 3D temperature field.
        <br />
        drag = orbit · scroll = zoom · panel top-right = controls
      </div>

      <div className="legend">
        temperature (synthetic)
        <div className="bar" />
        <div className="bar-labels">
          <span>~2&deg;C</span>
          <span>~30&deg;C</span>
        </div>
      </div>

      {!webgl2 && (
        <div className="err">
          <b>WebGL2 not available on this browser/GPU.</b>
          <br />
          The raymarch path needs WebGL2 (Data3DTexture / sampler3D). It cannot run
          here. This is a hard requirement, not something to work around.
        </div>
      )}

      <Canvas
        // low, close, angled across the surface — first-person, not a diorama
        camera={{ position: [-3, -1.1, 4], fov: 60, near: 0.1, far: 400 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => setWebgl2(gl.capabilities.isWebGL2)}
        dpr={dpr}
      >
        <color attach="background" args={['#05070d']} />
        {/* exponential fog, background colour — far falloff only, near view stays clear */}
        <fogExp2 attach="fog" args={['#05070d', fogDensity]} />

        <ambientLight intensity={0.55} />
        <directionalLight position={[40, 60, 20]} intensity={1.15} />

        <Bathymetry />
        <VolumeRaymarch />

        <OrbitControls
          target={[16, -3.2, 16]}
          minDistance={3}
          maxDistance={55}
          maxPolarAngle={Math.PI * 0.92}
          enablePan={false}
        />
        <Stats />
      </Canvas>
    </>
  )
}
