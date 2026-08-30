import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'

// Raycasting for hover + click.
//
// ARCHITECTURAL CHOICE (volume vs mesh): a volumetric field has no surface, so
// "the point under the cursor" is undefined for the volume alone. Rather than
// invent one (e.g. first-nonzero-alpha along the ray, which drifts with density
// and reads as noise), we hit-test two REAL surfaces and take the nearer:
//
//   1. the bathymetry mesh  -> a seafloor point, depth = true seafloor depth
//   2. the depth-clip plane -> when the user has cut the volume, the exposed
//      cross-section is a real surface through the water column
//
// Either way the value shown is sampled from the same RG8 volume the shader
// renders, via dataset.sampler. So hovering the seafloor reads the water just
// above it, and hovering a cross-section reads the water at that exact depth.
// If the user wants mid-water readings they pull the depth-clip slider — which
// is a control they already have.

export default function PointSelection({ dataset, terrainRef, enabled = true }) {
  const { camera, gl, scene } = useThree()
  const setHover = useVisualizationState((s) => s.setHover)
  const setSelected = useVisualizationState((s) => s.setSelected)
  const depthClip = useVisualizationState((s) => s.depthClip)
  const vertExag = useVisualizationState((s) => s.vertExag)

  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const ndc = useRef(new THREE.Vector2(0, 0))
  const inside = useRef(false)
  const clipPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const hitPoint = useRef(new THREE.Vector3())
  const lastEmit = useRef(0)

  const { boxSpan } = dataset.meta.bathymetry
  const half = boxSpan / 2

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
    // undo vertical exaggeration before converting to metres / sampling
    const yData = p.y / vertExag
    const depthM = map.yToDepth(yData)

    // Most of this region's seafloor is deeper than the 454 m thetao extent, so
    // a raw sample there returns nothing. Rather than a dead readout, sample at
    // the deepest level that DOES have data and label it — the reported seafloor
    // depth stays the true one. Disclosure, not invention.
    const clamped = depthM > maxDataM
    const sampleDepthM = clamped ? maxDataM : depthM
    const s = dataset.sampler(p.x, map.depthToY(sampleDepthM), p.z)

    return {
      world: [p.x, p.y, p.z],
      lat: map.zToLat(p.z),
      lon: map.xToLon(p.x),
      depthM,
      sampleDepthM,
      clamped,
      value: s.value,
      valid: s.valid,
      kind,
    }
  }

  const pick = () => {
    raycaster.setFromCamera(ndc.current, camera)
    let best = null
    let bestDist = Infinity

    const terrain = terrainRef?.current
    if (terrain) {
      const hits = raycaster.intersectObject(terrain, false)
      if (hits.length && hits[0].distance < bestDist) {
        bestDist = hits[0].distance
        best = { p: hits[0].point.clone(), kind: 'seafloor' }
      }
    }

    if (depthClip < 0) {
      clipPlane.current.constant = -depthClip * vertExag
      const hit = raycaster.ray.intersectPlane(clipPlane.current, hitPoint.current)
      if (hit) {
        const d = raycaster.ray.origin.distanceTo(hit)
        if (d < bestDist && Math.abs(hit.x) <= half && Math.abs(hit.z) <= half) {
          bestDist = d
          best = { p: hit.clone(), kind: 'cross-section' }
        }
      }
    }
    return best
  }

  useFrame(() => {
    if (!enabled || !inside.current) return
    // throttle to ~30 Hz; the raycast against a 512² mesh is not free
    const now = performance.now()
    if (now - lastEmit.current < 33) return
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
      if (moved > 4) return          // that was a drag (look / orbit), not a click
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
