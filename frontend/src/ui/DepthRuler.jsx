import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { blockLayout } from '../scene/blockLayout.js'
import { westStops, westCutForIndex } from '../scene/sliceStops.js'

// Depth ruler along the block's nearest right-hand vertical edge, drawn as a
// DOM/SVG overlay rather than in-scene text so the labels stay crisp at any
// zoom. Ticks are REAL metres: the block's vertical axis runs through the 0.42
// depth curve, so the spacing is deliberately non-uniform — that compression is
// what lets the shelf and the abyss share one block.

const NICE = [250, 500, 1000, 2000, 3000, 4000]
const MIN_GAP = 13        // px between labels; the depth curve crowds the deep end

export default function DepthRuler({ cameraRef, hostRef, dataset }) {
  const vertExag = useVisualizationState((s) => s.vertExag)
  const depthClip = useVisualizationState((s) => s.depthClip)
  const westIndex = useVisualizationState((s) => s.westIndex)
  const [, force] = useState(0)
  const raf = useRef(0)
  const v = useRef(new THREE.Vector3())

  useEffect(() => {
    const tick = () => {
      force((n) => (n + 1) % 1000000)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [])

  const camera = cameraRef?.current
  const host = hostRef?.current
  if (!camera || !host) return null

  const w = host.clientWidth
  const h = host.clientHeight
  const { bathyMaxM } = dataset.meta.bathymetry
  const maxDataM = dataset.meta.volume.maxDepthM
  const westCut = westCutForIndex(dataset, westStops(dataset), westIndex)
  const L = blockLayout(dataset, vertExag, depthClip, westCut)
  const { halfX, halfZ, xWest } = L

  const project = (x, y, z) => {
    v.current.set(x, y, z).project(camera)
    return {
      x: (v.current.x * 0.5 + 0.5) * w,
      y: (-v.current.y * 0.5 + 0.5) * h,
      behind: v.current.z > 1,
    }
  }

  // Only the three vertical edges of the two knife cuts are candidates: those
  // are the edges that actually run the full 0 -> deepest span. The torn shell
  // has no straight edge to rule against, and hanging ticks off it would put
  // the scale beside geometry that isn't the section.
  const corners = [[halfX, halfZ], [xWest, halfZ], [halfX, -halfZ]]
  const centre = project(0, L.wallTop, 0)
  const scored = corners
    .map(([x, z]) => {
      const s = project(x, L.wallTop, z)
      return { x, z, s, spread: s.x - centre.x }
    })
    .filter((c) => !c.s.behind)
  if (!scored.length) return null
  // Take the cut corner furthest from the block's centre on screen. That corner
  // is on the silhouette by construction, so the ruler always has empty panel
  // to hang its labels in — a nearer corner sits mid-block and writes the scale
  // straight over the section it is measuring.
  const edge = scored.reduce((a, b) => (Math.abs(b.spread) > Math.abs(a.spread) ? b : a))

  const dir = edge.spread >= 0 ? 1 : -1        // label outward, away from the block
  const off = 16 * dir

  const clipDepthM = L.clipDepthM

  const cand = []
  const add = (m, rank, label) => {
    if (m < clipDepthM - 0.5 || m > bathyMaxM + 0.5) return
    const p = project(edge.x, L.yOfDepthM(m), edge.z)
    if (p.behind) return
    cand.push({ m, rank, label, x: p.x, y: p.y })
  }
  add(clipDepthM, 2, `${clipDepthM.toFixed(0)} m`)          // the cut face
  add(maxDataM, 3, `${maxDataM.toFixed(0)} m`)              // the data floor
  add(bathyMaxM, 2, `${bathyMaxM.toFixed(0)} m`)            // deepest seafloor
  for (const m of NICE) add(m, 1, `${m} m`)

  // The 0.42 curve crowds the deep end badly, so thin the round-number ticks
  // against whatever the anchors already claim rather than letting them stack.
  const anchors = cand.filter((t) => t.rank > 1).sort((a, b) => a.y - b.y)
  const kept = [...anchors]
  for (const t of cand.filter((c) => c.rank === 1).sort((a, b) => a.y - b.y)) {
    if (kept.every((k) => Math.abs(k.y - t.y) >= MIN_GAP)) kept.push(t)
  }
  const ticks = kept.sort((a, b) => a.y - b.y)

  if (ticks.length < 2) return null
  const top = ticks[0]
  const bottom = ticks[ticks.length - 1]

  return (
    <svg className="depth-ruler" width={w} height={h}>
      <line x1={top.x + off} y1={top.y} x2={bottom.x + off} y2={bottom.y} className="spine" />
      {ticks.map((t) => (
        <g key={t.m} className={t.rank === 3 ? 'tick data' : t.rank === 2 ? 'tick strong' : 'tick'}>
          <line x1={t.x + off} y1={t.y} x2={t.x + off + 6 * dir} y2={t.y} />
          <text
            x={t.x + off + 10 * dir}
            y={t.y}
            textAnchor={dir > 0 ? 'start' : 'end'}
            dominantBaseline="middle"
          >
            {t.label}
          </text>
        </g>
      ))}
      <text
        className="cap"
        x={top.x + off + 10 * dir}
        y={top.y - 9}
        textAnchor={dir > 0 ? 'start' : 'end'}
      >
        DEPTH
      </text>
    </svg>
  )
}
