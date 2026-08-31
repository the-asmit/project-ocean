import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { blockLayout } from '../scene/blockLayout.js'
import { useCurrentsState, useCurrentsData } from './useCurrentsState.js'
import { streamlines, SEEDS, STEPS } from './currentsData.js'

// Streamlines through REAL GLORYS12V1 uo/vo.
//
// TWO PASSES, as the isosurface does. The block is opaque and a 300 m current
// lives inside it, so depthTest:false would paint the lines over the near
// shell and read as a UI layer pasted on the outside — the failure the Argo
// markers had. Instead the same geometry draws twice: normally depth-tested
// where it is exposed, and again with depthFunc GreaterDepth, the INVERSE
// test, which passes only where something is already in front. The buried part
// shows faintly through the block and the two passes cover the lines exactly
// once.
//
// Colour: currents are a different physical quantity from the temperature
// ramp, so they need a hue outside it. Violet is the only region of the space
// not already spoken for — the ramp runs blue-green-yellow-red, cyan is the
// cursor, amber the pinned point, steel/ink the Argo floats. It carried the
// synthetic marking during the spike; nothing is synthetic here now, and the
// token is named --flow rather than --synth for that reason.
const FLOW = '#a98cf0'

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
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    if (!show || !ready) return
    const { meta, frames } = data
    const f = frames[Math.min(frames.length - 1, frame)]
    const kmLon = (meta.lonMax - meta.lonMin) * 111.32
      * Math.cos(((meta.latMin + meta.latMax) / 2) * Math.PI / 180)
    const kmLat = (meta.latMax - meta.latMin) * 111.32
    const { points, live } = streamlines(f, meta, level, kmLon, kmLat)

    const arr = geometry.attributes.position.array
    const { spanX, spanZ } = dataset.map
    // The dash is built into the buffer, not taken from a material:
    // LineDashedMaterial measures along each segment pair independently, so
    // with 33 short segments per line the pattern restarts on every one.
    // Phase-shifting by the frame makes the gaps travel downstream as it plays.
    const PERIOD = 4, ON = 2
    let w = 0
    for (let s = 0; s < SEEDS; s++) {
      for (let i = 0; i < STEPS - 1; i++) {
        const a = (s * STEPS + i) * 2
        const lit = live[s] && (((i - frame) % PERIOD) + PERIOD) % PERIOD < ON
        const b = lit ? a + 2 : a       // degenerate segment renders nothing
        arr[w++] = (points[a] - 0.5) * spanX; arr[w++] = y; arr[w++] = (points[a + 1] - 0.5) * spanZ
        arr[w++] = (points[b] - 0.5) * spanX; arr[w++] = y; arr[w++] = (points[b + 1] - 0.5) * spanZ
      }
    }
    geometry.attributes.position.needsUpdate = true
    geometry.computeBoundingSphere()
    if (import.meta.env.DEV) {
      window.__oceanCurrents = { geometry, frame, depthM, level, meta, live }
    }
  }, [show, ready, data, frame, level, y, geometry, dataset.map, depthM])

  if (!show || !ready) return null

  return (
    <>
      {/* buried: only what the block is actually hiding */}
      <lineSegments geometry={geometry} raycast={() => null}>
        <lineBasicMaterial
          color={FLOW} transparent opacity={0.34}
          depthFunc={THREE.GreaterDepth} depthWrite={false}
        />
      </lineSegments>
      {/* exposed: correctly occluded by whatever block is in front */}
      <lineSegments geometry={geometry} raycast={() => null} renderOrder={2}>
        <lineBasicMaterial
          color={FLOW} transparent opacity={0.82} depthWrite={false}
        />
      </lineSegments>
    </>
  )
}
