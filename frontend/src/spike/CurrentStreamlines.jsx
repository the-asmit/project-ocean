import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { blockLayout } from '../scene/blockLayout.js'
import { useSpikeState } from './useSpikeState.js'
import { streamlines, SPIKE_LEVELS } from './syntheticCurrents.js'

// SPIKE — streamlines through a FABRICATED current field.
//
// VISUALLY DISTINCT ON PURPOSE. Violet sits outside the temperature ramp
// entirely (blue-green-yellow-red) and outside the three colours that already
// carry meaning: cyan is the cursor, amber the pinned point, steel/ink the Argo
// floats. Nothing real in this app is ever violet. The lines are also dashed,
// the same device the synthetic Argo profile already uses in the chart, and a
// SYNTHETIC FIELD chip sits in the viewport corner whenever this is on.
//
// The geometry buffer is allocated ONCE and rewritten in place on every frame.
// Stepping 6 times a second should not be handing the GC a new Float32Array
// each time, and it means a frame change touches nothing but this component.
const VIOLET = '#a98cf0'

export default function CurrentStreamlines({ dataset }) {
  const show = useSpikeState((s) => s.showCurrents)
  const frame = useSpikeState((s) => s.frame)
  const levelIndex = useSpikeState((s) => s.levelIndex)
  const vertExag = useVisualizationState((s) => s.vertExag)

  const level = SPIKE_LEVELS[levelIndex] ?? SPIKE_LEVELS[0]
  const L = blockLayout(dataset, vertExag, 0)
  const y = L.yOfDepthM(level.depthM)

  // one allocation for the life of the layer
  const { geometry, seeds, steps } = useMemo(() => {
    const s = streamlines(level.depthM, 0)
    const g = new THREE.BufferGeometry()
    // steps points per line -> (steps - 1) segments -> 2 vertices per segment
    const verts = s.seeds * (s.steps - 1) * 2
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
    return { geometry: g, seeds: s.seeds, steps: s.steps }
  }, [level.depthM])

  useEffect(() => () => geometry.dispose(), [geometry])

  // rewrite the buffer for the current frame and depth
  //
  // The dash is built into the buffer rather than taken from a material:
  // LineDashedMaterial measures along each LineSegments pair independently, so
  // with 33 short segments per line the pattern would restart on every one.
  // Emitting only part of the cycle, phase-shifted by the frame, gives both the
  // dash and a direction cue — the gaps travel downstream as the frames run.
  useEffect(() => {
    if (!show) return
    const { points } = streamlines(level.depthM, frame)
    const arr = geometry.attributes.position.array
    const { spanX, spanZ } = dataset.map
    const PERIOD = 4, ON = 2
    let w = 0
    for (let s = 0; s < seeds; s++) {
      for (let i = 0; i < steps - 1; i++) {
        const a = (s * steps + i) * 2
        const lit = (((i - frame) % PERIOD) + PERIOD) % PERIOD < ON
        // a skipped segment is written degenerate (both ends identical) so it
        // renders nothing while the buffer keeps its fixed size
        const b = lit ? a + 2 : a
        arr[w++] = (points[a] - 0.5) * spanX; arr[w++] = y; arr[w++] = (points[a + 1] - 0.5) * spanZ
        arr[w++] = (points[b] - 0.5) * spanX; arr[w++] = y; arr[w++] = (points[b + 1] - 0.5) * spanZ
      }
    }
    geometry.attributes.position.needsUpdate = true
    geometry.computeBoundingSphere()
    if (import.meta.env.DEV) {
      window.__oceanSpike = { geometry, frame, depthM: level.depthM, seeds, steps }
    }
  }, [show, frame, level.depthM, y, geometry, seeds, steps, dataset.map])

  if (!show) return null

  return (
    <lineSegments geometry={geometry} raycast={() => null} renderOrder={2}>
      <lineBasicMaterial
        color={VIOLET} transparent opacity={0.72}
        depthTest={false} depthWrite={false}
      />
    </lineSegments>
  )
}
