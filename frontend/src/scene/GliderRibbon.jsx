import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { blockLayout } from './blockLayout.js'
import { useGliderTrack } from '../observations/useObservations.js'
import { useColorScale } from '../state/useColorScale.js'

// A real glider track, drawn as a tube through the volume.
//
// WHY A PATH AND NOT A MARKER. A glider dives and climbs continuously while it
// drifts, so what it measured is a curve in (lon, lat, depth, time) — 232 dives
// over three weeks for the deployment shown here. A station marker would throw
// all of that away. Drawn as a tube it reads as what it is: a pleated curtain
// hanging inside the block, each fold one dive.
//
// COLOUR comes from useColorScale, the one scale the block shader, the charts
// and the colorbar all read — including whatever palette and range the user has
// set in the SCALE panel. That is deliberate: the ribbon and the block it hangs
// in are then on one scale, so a warm patch on the track means the same number
// as a warm voxel beside it. There is no second colour path.
//
// TWO PASSES, as the isosurface and the streamlines do. Half this track sits
// below the model's data extent and most of it is inside an opaque block, so
// the buried part is drawn with depthFunc GreaterDepth — the inverse test,
// which passes only where geometry is already in front — and the exposed part
// with the normal test. Between them every millimetre is drawn exactly once,
// and nothing is pasted over the near face.

// The block spans ~400 world units and a deployment drifts under a degree, so
// the track is a narrow curtain however it is drawn. A hairline tube vanished
// against the block's own blues; this is the smallest radius that still reads
// as an object from the home orbit.
const TUBE_RADIUS = 1.5
const RADIAL_SEGMENTS = 6

export default function GliderRibbon({ dataset }) {
  const show = useVisualizationState((s) => s.showGliders)
  const selected = useVisualizationState((s) => s.selectedGliderId)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const setGliderStats = useVisualizationState((s) => s.setGliderStats)
  const { status, track } = useGliderTrack(dataset, show ? selected : null)
  const scale = useColorScale(dataset)

  const v = dataset.meta.volume
  const variable = v.variable

  const built = useMemo(() => {
    if (status !== 'ready' || !track?.points?.length) return null
    const t0 = performance.now()
    const { map } = dataset
    const L = blockLayout(dataset, vertExag, 0)
    const pts = track.points

    // World-space path. Longitude/latitude go through the same mapping the
    // block uses, and depth through the same 0.42 curve, so the ribbon cannot
    // drift away from the field it is drawn against.
    const vec = []
    const vals = []
    for (const p of pts) {
      const x = map.lonToX(p.lon)
      const z = map.latToZ(p.lat)
      // pressure in decibars ~= depth in metres to well under 1% here
      const y = L.yOfDepthM(p.pres)
      vec.push(new THREE.Vector3(x, y, z))
      vals.push(p[variable])
    }
    if (vec.length < 4) return null

    // CatmullRom through the measured points. `centripetal` rather than the
    // default: a uniform spline overshoots badly at the dive apices, where the
    // path reverses within a couple of samples, and would draw loops the glider
    // never flew.
    const curve = new THREE.CatmullRomCurve3(vec, false, 'centripetal', 0.5)
    const segments = Math.min(4000, vec.length * 2)
    const geometry = new THREE.TubeGeometry(curve, segments, TUBE_RADIUS, RADIAL_SEGMENTS, false)

    // Per-vertex colour: TubeGeometry lays vertices out as
    // (segments + 1) rings of (RADIAL_SEGMENTS + 1), so ring i maps to the
    // curve at i / segments, and from there back to the nearest measured point.
    const ringCount = segments + 1
    const perRing = RADIAL_SEGMENTS + 1
    const colors = new Float32Array(ringCount * perRing * 3)
    let missing = 0
    for (let i = 0; i < ringCount; i++) {
      const f = (i / (ringCount - 1)) * (vals.length - 1)
      const k = Math.min(vals.length - 1, Math.round(f))
      let r = 0.42, g = 0.45, b = 0.5            // unmeasured: neutral grey
      const val = vals[k]
      if (val != null) {
        const c = scale.rgb(val)
        r = c[0] / 255; g = c[1] / 255; b = c[2] / 255
      } else missing++
      for (let j = 0; j < perRing; j++) {
        const o = (i * perRing + j) * 3
        colors[o] = r; colors[o + 1] = g; colors[o + 2] = b
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    return {
      geometry,
      ms: performance.now() - t0,
      points: vec.length,
      segments,
      missing,
      deepestY: Math.min(...vec.map((p) => p.y)),
    }
  }, [status, track, dataset, vertExag, variable, scale])

  // dispose the geometry a rebuild replaced
  useEffect(() => () => built?.geometry.dispose(), [built])

  useEffect(() => {
    if (!setGliderStats) return
    setGliderStats(built ? {
      points: built.points, ms: built.ms, missing: built.missing,
      deployment: track?.deployment, meta: track?.meta ?? null,
    } : null)
  }, [built, setGliderStats, track])

  useEffect(() => {
    if (import.meta.env.DEV) window.__oceanGlider = { built, track, status }
  })

  if (!show || !built) return null

  return (
    <>
      {/* buried: only what the block is actually hiding */}
      <mesh geometry={built.geometry} raycast={() => null}>
        <meshStandardMaterial
          vertexColors transparent opacity={0.3}
          roughness={0.75} metalness={0.05}
          side={THREE.DoubleSide}
          depthFunc={THREE.GreaterDepth} depthWrite={false}
        />
      </mesh>
      {/* exposed: correctly occluded by whatever block is in front */}
      <mesh geometry={built.geometry} raycast={() => null} renderOrder={2}>
        <meshStandardMaterial
          vertexColors transparent opacity={0.95}
          roughness={0.6} metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  )
}
