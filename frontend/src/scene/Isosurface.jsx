import { useDeferredValue, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { blockLayout } from './blockLayout.js'
import { westStops, westCutForIndex } from './sliceStops.js'
import { isosurfaceGeometry, cutBounds } from './marchingCubes.js'
import { ruggedChunk, chunkSeed } from './chunkGeometry.js'
import { rampRGB } from '../charts/sampling.js'

// The surface where the field equals one chosen value — the shape a 2D map
// cannot hold.
//
// TWO PASSES, ON PURPOSE. The block is opaque and the surface lives inside it,
// so a single correctly depth-tested pass is invisible until a slice opens the
// block: turn on the headline feature, see nothing. The fix is not
// depthTest:false, which would paint the surface over the block and read as a
// UI layer pasted on top — the exact failure the Argo markers had. Instead the
// same geometry is drawn twice:
//
//   SOLID  ordinary depth test — the part standing in open air once the top
//          cut has been dragged past it, correctly occluded by the block
//   GHOST  depthFunc GreaterDepth — the INVERSE test, so this pass draws only
//          where the surface is genuinely behind something. That is the whole
//          trick: depthTest:false would paint the ghost over the block's near
//          shell too, which reads as a coloured wedge stuck to the outside.
//          Testing for "further than what is already there" confines it to the
//          buried part, and the two passes together cover the surface exactly
//          once. Lit, so even the see-through pass has a shape.
//
// Colour is FLAT at the isovalue's own colorbar position, via the same rampRGB
// the charts and the colorbar use. The whole surface is one value; a depth
// gradient would imply variation that is not there. Lighting carries the shape.

// Y placement is linear in vertExag about boxMaxY = 0, so the exaggeration
// slider is a group scale rather than a rebuild — it stays at 60 fps and the
// mesh is only recomputed when the isovalue or a cut actually changes.
const BUILD_EXAG = 8

export default function Isosurface({ dataset }) {
  const show = useVisualizationState((s) => s.showIso)
  // The march costs 40-90 ms, which is fine per control change but would make
  // a drag of the isovalue slider choppy if every tick blocked. Deferring lets
  // React keep the slider and the camera responsive and rebuild behind them,
  // dropping intermediate values instead of queueing every one.
  const isoLive = useVisualizationState((s) => s.isoValue)
  const isoValue = useDeferredValue(isoLive)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const depthClip = useVisualizationState((s) => s.depthClip)
  const westIndex = useVisualizationState((s) => s.westIndex)
  const setIsoStats = useVisualizationState((s) => s.setIsoStats)
  const prev = useRef(null)

  const westCut = westCutForIndex(dataset, westStops(dataset), westIndex)
  const L = blockLayout(dataset, vertExag, depthClip, westCut)
  const { iMin, jMin } = cutBounds(dataset, L)

  const tileKey = `${dataset.meta.region}|${dataset.meta.date}|${dataset.meta.volume.variable}`

  // Built at a FIXED exaggeration; the group scales to the live one.
  const built = useMemo(() => {
    if (!show) return null
    const B = blockLayout(dataset, BUILD_EXAG, depthClip, westCut)
    // The block's own shell, rebuilt with the identical arguments DioramaBlock
    // uses, purely to read back its perimeter rings. Its Y is mesh-local
    // (the block sits at centerY), so the rings are lifted into world space.
    const shellGeom = ruggedChunk(
      B.spanX, B.spanZ, B.wallTop - B.centerY, B.geomBot - B.centerY,
      chunkSeed(tileKey), B.westCut,
    )
    const r = shellGeom.userData.rings
    const lift = (ring) => ring.map((q) => [q[0], q[1] + B.centerY, q[2]])
    const shell = { rings: { top: lift(r.top), bot: lift(r.bot) }, topY: B.wallTop, botY: B.geomBot }
    shellGeom.dispose()
    return isosurfaceGeometry(dataset, {
      isoValue, yOfDepthM: B.yOfDepthM, iMin, jMin, shell,
    })
  }, [show, dataset, tileKey, isoValue, iMin, jMin, depthClip, westCut])

  // dispose the geometry the previous build replaced
  useEffect(() => {
    if (prev.current && prev.current !== built?.geometry) prev.current.dispose()
    prev.current = built?.geometry ?? null
  }, [built])
  useEffect(() => () => prev.current?.dispose(), [])

  // publish counts for the panel readout and the P3 line
  useEffect(() => {
    setIsoStats(
      built
        ? { triangles: built.triangles, vertices: built.vertices, ms: built.ms, empty: false }
        : { triangles: 0, vertices: 0, ms: 0, empty: show },
    )
  }, [built, show, setIsoStats])

  useEffect(() => {
    if (import.meta.env.DEV) window.__oceanIso = { dataset, built, isoValue, vertExag, iMin, jMin }
  })

  const color = useMemo(() => {
    const { valueMin, valueMax } = dataset.meta.volume
    const [r, g, b] = rampRGB((isoValue - valueMin) / (valueMax - valueMin))
    return new THREE.Color(`rgb(${r},${g},${b})`)
  }, [dataset, isoValue])

  if (!show || !built) return null
  const s = vertExag / BUILD_EXAG

  return (
    <group scale={[1, s, 1]}>
      {/* still buried: only what the block is actually hiding */}
      <mesh geometry={built.geometry} raycast={() => null}>
        <meshStandardMaterial
          color={color} transparent opacity={0.3} side={THREE.DoubleSide}
          roughness={0.6} metalness={0.05}
          depthFunc={THREE.GreaterDepth} depthWrite={false}
        />
      </mesh>
      {/* exposed: the real surface, occluded by whatever block is left */}
      <mesh geometry={built.geometry} raycast={() => null} renderOrder={1}>
        <meshStandardMaterial
          color={color} transparent opacity={0.66} side={THREE.DoubleSide}
          roughness={0.5} metalness={0.05} depthWrite={false}
        />
      </mesh>
    </group>
  )
}
