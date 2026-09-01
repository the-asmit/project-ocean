import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { blockLayout } from '../scene/blockLayout.js'
import { useCurrentsState, useCurrentsData } from './useCurrentsState.js'
import { streamlines, SEEDS, STEPS } from './currentsData.js'

// Streamlines through REAL GLORYS12V1 uo/vo, with an arrowhead per line.
//
// TWO PASSES, as the isosurface does. The block is opaque and a 300 m current
// lives inside it, so depthTest:false would paint the lines over the near
// shell and read as a UI layer pasted on the outside — the failure the Argo
// markers had. Instead the same geometry draws twice: normally depth-tested
// where it is exposed, and again with depthFunc GreaterDepth, the INVERSE
// test, which passes only where something is already in front. The buried part
// shows faintly through the block and the two passes cover the lines exactly
// once. At a shallow level almost everything is "buried" — the lines sit just
// under the box's own top face — so the ghost pass carries most of the layer,
// which is why its opacity has to stay low enough not to turn into noise.
//
// DIRECTION comes from an arrowhead, not from a dash. The dash was a flat
// triangle wave built into the line buffer, and with the old seed density it
// broke every line into dots that read as speckle rather than movement. A flow
// field with no arrowheads is also genuinely ambiguous: a streamline drawn
// through it looks identical forwards and backwards. The head is a flat
// triangle lying in the level's own horizontal plane, which is the correct
// shape here because a streamline at one depth IS horizontal — it needs no
// lighting to read, and it never presents itself edge-on from above.
//
// Colour: currents are a different physical quantity from the temperature
// ramp, so they need a hue outside it. Violet is the only region of the space
// not already spoken for — the ramp runs blue-green-yellow-red, cyan is the
// cursor, amber the pinned point, steel/ink the Argo floats.
const FLOW = '#a98cf0'

// Arrowhead size in world units, against a ~400-unit block and ~28-unit lines.
const HEAD_LEN = 5.2
const HEAD_HALF = 2.1

export default function CurrentStreamlines({ dataset }) {
  const show = useCurrentsState((s) => s.showCurrents)
  const frame = useCurrentsState((s) => s.frame)
  const levelIndex = useCurrentsState((s) => s.levelIndex)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const data = useCurrentsData(dataset)

  const ready = data.status === 'ready'
  const level = ready
    ? Math.min(data.meta.depthLevels.length - 1, levelIndex)
    : 0
  const depthM = ready ? data.meta.depthLevels[level] : 0
  const L = blockLayout(dataset, vertExag, 0)
  const y = L.yOfDepthM(depthM)

  // allocated once, rewritten in place — stepping 3 times a second should not
  // be handing the GC a new buffer each frame
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array(SEEDS * (STEPS - 1) * 2 * 3), 3))
    return g
  }, [])
  const heads = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEEDS * 3 * 3), 3))
    return g
  }, [])
  useEffect(() => () => { geometry.dispose(); heads.dispose() }, [geometry, heads])

  useEffect(() => {
    if (!show || !ready) return
    const { meta, frames } = data
    const f = frames[Math.min(frames.length - 1, frame)]
    const kmLon = (meta.lonMax - meta.lonMin) * 111.32
      * Math.cos(((meta.latMin + meta.latMax) / 2) * Math.PI / 180)
    const kmLat = (meta.latMax - meta.latMin) * 111.32
    const t0 = performance.now()
    const { points, live } = streamlines(f, meta, level, kmLon, kmLat)
    const traceMs = performance.now() - t0

    const arr = geometry.attributes.position.array
    const head = heads.attributes.position.array
    const { spanX, spanZ } = dataset.map
    const wx = (u) => (u - 0.5) * spanX
    const wz = (u) => (u - 0.5) * spanZ

    let w = 0
    for (let s = 0; s < SEEDS; s++) {
      for (let i = 0; i < STEPS - 1; i++) {
        const a = (s * STEPS + i) * 2
        // A line that never started, or that ran into land, holds its last
        // position for the rest of its steps, so those segments are degenerate
        // and draw nothing without needing a special case.
        arr[w++] = wx(points[a]); arr[w++] = y; arr[w++] = wz(points[a + 1])
        arr[w++] = wx(points[a + 2]); arr[w++] = y; arr[w++] = wz(points[a + 3])
      }
    }
    geometry.attributes.position.needsUpdate = true
    geometry.computeBoundingSphere()

    // One head per line, advancing with the frame so it travels downstream as
    // the days play. Phase-shifted per seed so they do not march in lockstep.
    let h = 0
    const SPAN = STEPS - 3
    for (let s = 0; s < SEEDS; s++) {
      const i = live[s] ? ((frame * 3 + ((s * 7) % SPAN)) % SPAN) + 1 : 0
      const a = (s * STEPS + i) * 2
      const x0 = wx(points[a]), z0 = wz(points[a + 1])
      const x1 = wx(points[a + 2]), z1 = wz(points[a + 3])
      let dx = x1 - x0, dz = z1 - z0
      const len = Math.hypot(dx, dz)
      if (!live[s] || len < 1e-4) {
        // nothing to point at: collapse the triangle rather than draw a spike
        for (let k = 0; k < 9; k++) head[h++] = 0
        continue
      }
      dx /= len; dz /= len
      // tip ahead of the sample, base behind it, perpendicular in the XZ plane
      head[h++] = x1 + dx * HEAD_LEN; head[h++] = y; head[h++] = z1 + dz * HEAD_LEN
      head[h++] = x1 - dz * HEAD_HALF; head[h++] = y; head[h++] = z1 + dx * HEAD_HALF
      head[h++] = x1 + dz * HEAD_HALF; head[h++] = y; head[h++] = z1 - dx * HEAD_HALF
    }
    heads.attributes.position.needsUpdate = true
    heads.computeBoundingSphere()

    if (import.meta.env.DEV) {
      window.__oceanCurrents = {
        geometry, heads, frame, depthM, level, meta, live,
        traceMs, buildMs: performance.now() - t0,
      }
    }
  }, [show, ready, data, frame, level, y, geometry, heads, dataset.map, depthM])

  if (!show || !ready) return null

  return (
    <>
      {/* buried: only what the block is actually hiding */}
      <lineSegments geometry={geometry} raycast={() => null}>
        <lineBasicMaterial
          color={FLOW} transparent opacity={0.26}
          depthFunc={THREE.GreaterDepth} depthWrite={false}
        />
      </lineSegments>
      <mesh geometry={heads} raycast={() => null}>
        <meshBasicMaterial
          color={FLOW} transparent opacity={0.34} side={THREE.DoubleSide}
          depthFunc={THREE.GreaterDepth} depthWrite={false}
        />
      </mesh>
      {/* exposed: correctly occluded by whatever block is in front */}
      <lineSegments geometry={geometry} raycast={() => null} renderOrder={2}>
        <lineBasicMaterial
          color={FLOW} transparent opacity={0.75} depthWrite={false}
        />
      </lineSegments>
      <mesh geometry={heads} raycast={() => null} renderOrder={3}>
        <meshBasicMaterial
          color={FLOW} transparent opacity={0.92} side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </>
  )
}
