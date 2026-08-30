import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { makeSeafloorAt } from '../charts/sampling.js'
import { blockLayout } from '../scene/blockLayout.js'

// Raycasting for hover + click, against the bounded diorama block.
//
// ARCHITECTURAL CHOICE (volume vs surface): a volumetric field has no surface,
// so "the point under the cursor" is undefined for the field alone. The block
// gives us real ones: its cut faces ARE cross-sections through the water
// column, so every hit is a genuine (lat, lon, depth) with a genuine value.
//   * a side wall   -> a vertical section point at that depth
//   * the top face  -> the sea surface, or the horizontal section once the
//                      depth-clip has sliced the block down
//
// Either way the value shown is sampled from the same RG8 volume the block
// shader renders, via dataset.sampler — one number, one source.
export default function PointSelection({ dataset, blockRef, enabled = true }) {
  const { camera, gl } = useThree()
  const setHover = useVisualizationState((s) => s.setHover)
  const setSelected = useVisualizationState((s) => s.setSelected)
  const depthClip = useVisualizationState((s) => s.depthClip)
  const vertExag = useVisualizationState((s) => s.vertExag)

  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const ndc = useRef(new THREE.Vector2(0, 0))
  const inside = useRef(false)
  const lastEmit = useRef(0)

  const seafloorAt = useMemo(() => makeSeafloorAt(dataset), [dataset])

  useEffect(() => {
    const el = gl.domElement
    const move = (e) => {
      const r = el.getBoundingClientRect()
      ndc.current.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      )
      inside.current = true
    }
    const leave = () => { inside.current = false; setHover(null) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [gl, setHover])

  // build a readout from a world-space hit
  const readout = (p, kind) => {
    const map = dataset.map
    const maxDataM = dataset.meta.volume.maxDepthM
    // depth through the shared block layout: the bevel offsets world Y, so
    // dividing by vertExag alone would report every point too shallow
    const depthM = blockLayout(dataset, vertExag, depthClip).depthMOfY(p.y)

    // Most of this basin's seafloor is far deeper than the 454 m thetao extent,
    // so a raw sample there returns nothing. Rather than a dead readout, sample
    // at the deepest level that DOES have data and label it — the reported
    // depth stays the true one. Disclosure, not invention.
    const clamped = depthM > maxDataM
    const sampleDepthM = clamped ? maxDataM : depthM
    const s = dataset.sampler(p.x, map.depthToY(sampleDepthM), p.z)

    const floorM = seafloorAt(p.x, p.z)
    const belowFloor = Number.isFinite(floorM) && depthM > floorM + 1

    return {
      world: [p.x, p.y, p.z],
      lat: map.zToLat(p.z),
      lon: map.xToLon(p.x),
      depthM,
      sampleDepthM,
      clamped,
      seafloorM: Number.isFinite(floorM) ? floorM : null,
      value: s.value,
      valid: s.valid,
      kind: belowFloor ? 'below seafloor' : kind,
    }
  }

  const pick = () => {
    const block = blockRef?.current
    if (!block) return null
    raycaster.setFromCamera(ndc.current, camera)
    const hits = raycaster.intersectObject(block, false)
    if (!hits.length) return null

    const h = hits[0]
    // Which face we landed on comes from the geometry's per-triangle kind, not
    // the normal: the torn outer shell's normals point in every direction, and
    // that shell is rock — it carries no field value and must report none.
    const kinds = block.geometry?.userData?.faceKind
    const k = kinds ? kinds[h.faceIndex] : 1
    if (k === 0 || k === 3) return null            // torn shell / base
    const kind = k === 2
      ? (depthClip < -0.001 ? 'cross-section' : 'sea surface')
      : 'cross-section'
    return { p: h.point.clone(), kind }
  }

  useFrame(() => {
    if (!enabled || !inside.current) return
    const now = performance.now()
    if (now - lastEmit.current < 33) return    // ~30 Hz
    lastEmit.current = now

    const hit = pick()
    setHover(hit ? readout(hit.p, hit.kind) : null)
  })

  // NOTE: pick/readout close over live props, so keep them in refs rather than
  // in the effect's dependency array — this effect must NOT be torn down on
  // every hover update, or the pointerdown position is lost before pointerup.
  const pickRef = useRef()
  const readoutRef = useRef()
  pickRef.current = pick
  readoutRef.current = readout

  const downAt = useRef(null)
  useEffect(() => {
    const el = gl.domElement
    const down = (e) => { if (e.button === 0) downAt.current = { x: e.clientX, y: e.clientY } }
    const up = (e) => {
      if (e.button !== 0 || !downAt.current) return
      const moved = Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y)
      downAt.current = null
      if (moved > 4) return          // that was an orbit drag, not a click
      const hit = pickRef.current()
      if (hit) setSelected(readoutRef.current(hit.p, hit.kind))
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
    }
  }, [gl, setSelected])

  return null
}
