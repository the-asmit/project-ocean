import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stats } from '@react-three/drei'
import { Leva } from 'leva'
import Bathymetry from './Bathymetry.jsx'
import VolumeRaymarch from './VolumeRaymarch.jsx'
import { loadTile } from './realdata.js'

export default function App() {
  const [webgl2, setWebgl2] = useState(true)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  const qs = new URLSearchParams(window.location.search)
  const dpr = qs.has('dpr') ? parseFloat(qs.get('dpr')) : [1, 1.75]
  const fogDensity = qs.has('fog') ? parseFloat(qs.get('fog')) : 0.011
  const tile = qs.get('tile') === 'open' ? 'open' : 'coastal'

  // Screenshot harness only: ?cam=x,y,z and ?tgt=x,y,z pin an exact viewpoint so
  // before/after comparisons are from an identical camera. Defaults unchanged.
  const vec3 = (k, d) => {
    const v = qs.get(k)
    if (!v) return d
    const p = v.split(',').map(parseFloat)
    return p.length === 3 && p.every(Number.isFinite) ? p : d
  }
  const camPos = vec3('cam', [-3, -1.1, 4])
  const camTarget = vec3('tgt', [16, -3.2, 16])
  const detailGain = qs.has('detail') ? Math.max(0, parseFloat(qs.get('detail')) || 0) : 1

  useEffect(() => {
    loadTile(tile).then(setData).catch((e) => setErr(String(e)))
  }, [tile])

  if (err) return <div className="err"><b>Load failed.</b><br />{err}</div>
  if (!data) return <div className="msg">loading real GLORYS tile ({tile})…</div>

  const m = data.meta
  return (
    <>
      <Leva collapsed={false} />

      <div className="hud">
        <b>Ocean-Viz — REAL-DATA spike</b>
        <br />
        GLORYS <code>thetao</code> 2020-01-01 · tile <b>{tile}</b> ({m.latMin}–{m.latMax}°N,{' '}
        {m.lonMin}–{m.lonMax}°E)
        <br />
        grid {m.W}×{m.H}×{m.D} · thetao 0–{m.maxDepthM.toFixed(0)} m · bathy to{' '}
        {m.bathyMaxM.toFixed(0)} m ·{' '}
        <span className="warn">{(m.nanFraction * 100).toFixed(1)}% NaN</span>
        <br />
        <span className="src">
          SOURCE: seafloor SHAPE + all temperature values are real GLORYS/CMEMS.
          {' '}Sub-grid seafloor <b>surface texture is SYNTHETIC</b> (decorative,
          {' '}±{(0.14 * detailGain).toFixed(2)} world-units, zero-mean — real grid is 1/12°≈9 km).
          {' '}Depth axis exaggerated non-linearly (curve {m.depthCurve}).
        </span>
        <br />
        drag = orbit · scroll = zoom · <code>?tile=open</code> · <code>?detail=0</code> hides
        {' '}synthetic texture · <code>?thin=1</code> disables thickness-aware density
      </div>

      <div className="legend">
        temperature (real, °C)
        <div className="bar" />
        <div className="bar-labels">
          <span>{m.tempMin}°</span>
          <span>{m.tempMax}°</span>
        </div>
      </div>

      {!webgl2 && (
        <div className="err">
          <b>WebGL2 not available.</b> Needs Data3DTexture / sampler3D.
        </div>
      )}

      <Canvas
        camera={{ position: camPos, fov: 60, near: 0.1, far: 400 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => setWebgl2(gl.capabilities.isWebGL2)}
        dpr={dpr}
      >
        <color attach="background" args={['#05070d']} />
        <fogExp2 attach="fog" args={['#05070d', fogDensity]} />

        <ambientLight intensity={0.55} />
        <directionalLight position={[40, 60, 20]} intensity={1.15} />

        <Bathymetry bathy={data.bathy} meta={data.meta} />
        <VolumeRaymarch field={data.field} lut={data.lut} height={data.height} />

        <OrbitControls
          target={camTarget}
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
