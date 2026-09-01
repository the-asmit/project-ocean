import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { useHeatPotential } from '../state/useHeatPotential.js'
import { blockLayout } from './blockLayout.js'
import { westStops, westCutForIndex } from './sliceStops.js'
import { ruggedChunk, chunkSeed } from './chunkGeometry.js'
import { makeInsideShell } from './marchingCubes.js'
import { marchingSquares } from './contourLines.js'
import { paletteRGB } from './colorScale.js'
import { THRESHOLD, TCHP_MAX } from './heatPotential.js'

// ===========================================================================
// The cyclone layer: D26 as a warped sheet inside the block, TCHP as a field on
// its top, and the 40 kJ/cm2 threshold contour drawn on BOTH.
//
// ONE QUANTITY IN COLOUR. Height is D26 and colour is TCHP, on both sheets, so
// there is one legend and one threshold in the whole layer. Colouring the
// warped sheet by its own depth would have put the same fact in the geometry
// and in the ramp at once and left the actual operational number — the heat —
// with nowhere to live. The flat sheet is then the same colour field projected
// to the surface, and the two read as one story: the sheet dips where the water
// is warm, and it is bright where that warm layer holds heat.
//
// THE MESH TECHNIQUE IS NOT NEW. It is BathymetryTerrain.jsx's: a plane grid,
// rotated flat, with per-vertex Y taken from a per-(lon,lat) field and per-vertex
// colour taken from the data, scaled about y=0 so vertical exaggeration is a
// group transform rather than a rebuild. That component is not currently
// mounted — the shipped seafloor is drawn inside DioramaBlock's fragment shader
// from uHeightMap — so this brings the technique back into service rather than
// inventing a second one. Two things it did not need and this does:
//
//   TWO PASSES  The sheet lives inside an opaque block. A single correctly
//     depth-tested pass is invisible until a slice opens the block: turn on the
//     headline feature, see nothing. Same solid + GreaterDepth ghost pair the
//     isosurface uses, for the same reason, and depthTest:false is still wrong
//     for the same reason.
//   SHELL CLIP  The torn shell is displaced INWARD in places, so a sheet drawn
//     at the tile's full extent pokes out through the rock as a coloured fin.
//     Clipped to the rings chunkGeometry already publishes, read-only.
//
// The grid is the volume's OWN (W, D): one vertex per data column, so nothing
// here interpolates the field sideways. Quads with any invalid corner are
// dropped rather than stitched, which leaves honest holes over land and an open
// edge at the coast.
// ===========================================================================

// Built at a fixed exaggeration; the group scales to the live one. Y is linear
// in vertExag about y=0 (depth 0 is y=0), so this is exact, not an approximation.
const BUILD_EXAG = 8

const CONTOUR = new THREE.Color('#eaf1ff')

// ---------------------------------------------------------------------------
// MOUNT-IN. 600 ms, cubic ease-out.
//
// THIS MOVES A DRAWING, NOT A DATUM. Both grids are computed in full before the
// first animated frame — the useMemo above has already run. What eases is the
// group's Y SCALE, from 0 (the sheet flat at the sea surface) to 1 (every vertex
// at the depth it was built with), and the contour's drawRange, which reveals
// segments that already exist in the buffer. No value is interpolated, nothing
// is faded in from a placeholder, and there is no intermediate state in which
// the sheet is at a depth the data does not support. Freeze it at any t and
// every point on screen is the true D26 scaled by t — which is exactly what the
// vertical-exaggeration control already does, and is disclosed in the footer.
//
// The scale trick is only available because depth 0 is world y = 0: scaling Y
// about the origin maps every depth to t x depth, so "flat at the surface" is
// literally t = 0. Nothing has to be re-meshed per frame.
//
// The surface and the field animate INDEPENDENTLY, because their triggers are
// different: un-slicing brings the TCHP lid back and it should fade in, but the
// D26 sheet never left and must not drop through the block again.
const MOUNT_MS = 600
const easeOut = (x) => 1 - Math.pow(1 - x, 3)

function newAnim(reduced) {
  return reduced
    ? { start: 0, raw: 1, t: 1, running: false }
    : { start: performance.now(), raw: 0, t: 0, running: true }
}
// WALL CLOCK, NOT ACCUMULATED DELTAS. Summing per-frame dt makes the duration a
// function of the frame rate: the frame that commits the toggle carries React's
// own work in its delta (~200 ms measured headless, a third of the whole
// mount-in), so the sheet jumps a third of the way before it is drawn once.
// Capping the step fixes the jump and introduces the opposite fault — a slow
// renderer stretches 600 ms into two seconds. Reading the clock does neither: the
// mount-in always takes 600 ms, and a slow renderer simply shows fewer steps of
// it, which is what it should show.
function stepAnim(a) {
  if (!a.running) return
  a.raw = Math.min(1, (performance.now() - a.start) / MOUNT_MS)
  a.t = easeOut(a.raw)
  if (a.raw >= 1) a.running = false
}
// Honoured at the moment the layer appears rather than read once at module load,
// so a viewer who turns the preference on mid-session gets it immediately.
const prefersReduced = () =>
  typeof window !== 'undefined'
  && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ---------------------------------------------------------------------------

function sheetGeometry({ heat, spanX, spanZ, yOf, inside, xWest, flat, paletteId }) {
  const { W, D, d26, tchp } = heat
  const pos = new Float32Array(W * D * 3)
  const col = new Float32Array(W * D * 3)
  const ok = new Uint8Array(W * D)
  const c = new THREE.Color()

  for (let k = 0; k < D; k++) {
    for (let i = 0; i < W; i++) {
      const n = k * W + i
      const x = (i / (W - 1) - 0.5) * spanX
      const z = (k / (D - 1) - 0.5) * spanZ
      const dv = d26[n]
      const tv = tchp[n]
      // flat sheet sits at depth 0; the warped one at the depth of the isotherm
      const y = flat || !Number.isFinite(dv) ? 0 : yOf(dv)
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z

      // A vertex is usable when it carries a value, survives the west cut, and
      // is inside the chunk's torn silhouette. The warped sheet additionally
      // needs a D26 to sit at — a column with no warm layer has no sheet, and a
      // sheet drawn at 0 m there would claim one.
      ok[n] = Number.isFinite(tv) && (flat || Number.isFinite(dv))
        && x >= xWest - 1e-6 && inside(x, y, z) ? 1 : 0

      const [r, g, b] = paletteRGB(paletteId, (Number.isFinite(tv) ? tv : 0) / TCHP_MAX)
      // through sRGB, exactly as the isosurface's THREE.Color(css) does, or the
      // same byte would render as two different colours on the two layers
      c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
      col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b
    }
  }

  const idx = []
  for (let k = 0; k < D - 1; k++) {
    for (let i = 0; i < W - 1; i++) {
      const a = k * W + i, b = a + 1, cc = a + W + 1, d = a + W
      if (!(ok[a] && ok[b] && ok[cc] && ok[d])) continue
      idx.push(a, d, b, b, d, cc)          // wound +Y up
    }
  }
  if (!idx.length) return null

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  g.userData.triangles = idx.length / 3
  return g
}

function contourGeometry({ heat, spanX, spanZ, yOf, inside, xWest, flat }) {
  const { W, D, d26, tchp } = heat
  const segs = marchingSquares(tchp, W, D, THRESHOLD)
  if (!segs.length) return null

  // Bilinear read of the sheet's own height at a fractional grid position, so
  // the line lies ON the surface instead of near it.
  const heightAt = (fi, fk) => {
    if (flat) return 0
    const i0 = Math.min(W - 2, Math.floor(fi)), tx = fi - i0
    const k0 = Math.min(D - 2, Math.floor(fk)), tz = fk - k0
    const n = [k0 * W + i0, k0 * W + i0 + 1, (k0 + 1) * W + i0, (k0 + 1) * W + i0 + 1]
    const wt = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz]
    let acc = 0
    for (let q = 0; q < 4; q++) {
      const dv = d26[n[q]]
      if (!Number.isFinite(dv)) return null   // the line stops where the sheet does
      acc += dv * wt[q]
    }
    return yOf(acc)
  }

  const pos = []
  for (let s = 0; s < segs.length; s += 4) {
    const x0 = (segs[s] / (W - 1) - 0.5) * spanX
    const z0 = (segs[s + 1] / (D - 1) - 0.5) * spanZ
    const x1 = (segs[s + 2] / (W - 1) - 0.5) * spanX
    const z1 = (segs[s + 3] / (D - 1) - 0.5) * spanZ
    if (x0 < xWest - 1e-6 || x1 < xWest - 1e-6) continue
    const y0 = heightAt(segs[s], segs[s + 1])
    const y1 = heightAt(segs[s + 2], segs[s + 3])
    if (y0 === null || y1 === null) continue
    if (!inside(x0, y0, z0) || !inside(x1, y1, z1)) continue
    pos.push(x0, y0, z0, x1, y1, z1)
  }
  if (!pos.length) return null

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeBoundingSphere()
  g.userData.segments = pos.length / 6
  return g
}

// ---------------------------------------------------------------------------

export default function HeatPotential({ dataset }) {
  const show = useVisualizationState((s) => s.showHeat)
  const wantSurface = useVisualizationState((s) => s.heatD26)
  const wantFieldOn = useVisualizationState((s) => s.heatField)
  const clipIndex = useVisualizationState((s) => s.clipIndex)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const depthClip = useVisualizationState((s) => s.depthClip)
  const westIndex = useVisualizationState((s) => s.westIndex)
  const paletteId = useVisualizationState((s) => s.palette)
  const heat = useHeatPotential(dataset)
  const prev = useRef([])

  // A sliced block's top face is the REAL horizontal section, and this app
  // already has a rule about that: the stylized surface is removed the moment
  // the knife comes down, because a top-face treatment belongs to whatever is
  // actually at the top. The TCHP field is a top-face treatment, so it obeys the
  // same rule. It would otherwise hover at depth 0 over the very section the
  // user just cut in order to see. Nothing is lost: TCHP is still on the cursor
  // card and the stat cards, because it was computed, not drawn.
  const wantField = wantFieldOn && clipIndex === 0

  const westCut = westCutForIndex(dataset, westStops(dataset), westIndex)
  const tileKey = `${dataset.meta.region}|${dataset.meta.date}|${dataset.meta.volume.variable}`

  const built = useMemo(() => {
    if (!show || !heat) return null
    const B = blockLayout(dataset, BUILD_EXAG, depthClip, westCut)

    // The block's own shell, rebuilt with the identical arguments DioramaBlock
    // uses, purely to read back its perimeter rings. Its Y is mesh-local (the
    // block sits at centerY), so the rings are lifted into world space. Same
    // read-only trick the isosurface uses; nothing about the shell changes.
    const shellGeom = ruggedChunk(
      B.spanX, B.spanZ, B.wallTop - B.centerY, B.geomBot - B.centerY,
      chunkSeed(tileKey), B.westCut,
    )
    const r = shellGeom.userData.rings
    const lift = (ring) => ring.map((q) => [q[0], q[1] + B.centerY, q[2]])
    const inside = makeInsideShell(
      { top: lift(r.top), bot: lift(r.bot) }, B.wallTop, B.geomBot,
    )
    shellGeom.dispose()

    const common = {
      heat, spanX: B.spanX, spanZ: B.spanZ, yOf: B.yOfDepthM,
      inside, xWest: B.xWest, paletteId,
    }
    return {
      surface: sheetGeometry({ ...common, flat: false }),
      field: sheetGeometry({ ...common, flat: true }),
      surfaceLine: contourGeometry({ ...common, flat: false }),
      fieldLine: contourGeometry({ ...common, flat: true }),
    }
  }, [show, heat, dataset, tileKey, depthClip, westCut, paletteId])

  // dispose whatever the previous build replaced
  useEffect(() => {
    const now = built ? Object.values(built).filter(Boolean) : []
    for (const g of prev.current) if (!now.includes(g)) g.dispose()
    prev.current = now
    return undefined
  }, [built])
  useEffect(() => () => { for (const g of prev.current) g.dispose() }, [])

  useEffect(() => {
    if (import.meta.env.DEV) window.__oceanHeatMesh = { built, heat, show }
  })

  // --- mount-in ----------------------------------------------------------
  const surfGroup = useRef()
  const fieldMat = useRef()
  const drapedLine = useRef()
  const flatLine = useRef()
  const animSurf = useRef({ start: 0, raw: 1, t: 1, running: false })
  const animField = useRef({ start: 0, raw: 1, t: 1, running: false })
  const was = useRef({ surf: false, field: false })

  const surfLive = show && !!heat && wantSurface
  const fieldLive = show && !!heat && wantField
  useEffect(() => {
    const reduced = prefersReduced()
    if (surfLive && !was.current.surf) animSurf.current = newAnim(reduced)
    if (fieldLive && !was.current.field) animField.current = newAnim(reduced)
    was.current = { surf: surfLive, field: fieldLive }
  }, [surfLive, fieldLive])

  const s = vertExag / BUILD_EXAG

  // Applied every frame rather than through JSX props, so React re-rendering
  // mid-animation (a palette change, a slice) cannot stamp the final value back
  // over the eased one. Two assignments and two drawRange calls; nothing here
  // touches geometry.
  useFrame(() => {
    const a = animSurf.current
    const f = animField.current
    stepAnim(a)
    stepAnim(f)
    if (surfGroup.current) surfGroup.current.scale.set(1, s * a.t, 1)
    if (fieldMat.current) fieldMat.current.opacity = 0.9 * f.t
    // even counts only: a line segment is two vertices and half of one is a ray
    const walk = (ref, t) => {
      if (!ref.current) return
      const n = ref.current.geometry.attributes.position.count
      ref.current.geometry.setDrawRange(0, Math.floor((n * t) / 2) * 2)
    }
    walk(drapedLine, a.t)
    walk(flatLine, f.t)
    if (import.meta.env.DEV) {
      window.__oceanHeatAnim = {
        surf: a.t, surfRaw: a.raw, field: f.t, fieldRaw: f.raw,
        running: a.running || f.running,
      }
    }
  })

  if (!show || !built) return null

  return (
    <>
      {/* D26 — inside the block, so it needs both passes */}
      {wantSurface && built.surface && (
        <group ref={surfGroup} scale={[1, s, 1]}>
          <mesh geometry={built.surface} raycast={() => null}>
            <meshStandardMaterial
              vertexColors transparent opacity={0.42} side={THREE.DoubleSide}
              roughness={0.62} metalness={0.04}
              depthFunc={THREE.GreaterDepth} depthWrite={false}
            />
          </mesh>
          <mesh geometry={built.surface} raycast={() => null} renderOrder={1}>
            <meshStandardMaterial
              vertexColors transparent opacity={0.82} side={THREE.DoubleSide}
              roughness={0.5} metalness={0.04} depthWrite={false}
            />
          </mesh>
          {built.surfaceLine && (
            <>
              <lineSegments geometry={built.surfaceLine} renderOrder={2}>
                <lineBasicMaterial
                  color={CONTOUR} transparent opacity={0.4}
                  depthFunc={THREE.GreaterDepth} depthWrite={false}
                />
              </lineSegments>
              {/* Both passes share ONE geometry, so one drawRange walk reveals
                  the buried half and the exposed half together. */}
              <lineSegments ref={drapedLine} geometry={built.surfaceLine} renderOrder={3}>
                <lineBasicMaterial color={CONTOUR} depthWrite={false} />
              </lineSegments>
            </>
          )}
        </group>
      )}

      {/* TCHP — a surface quantity, so it stays at depth 0 and floats clear of
          the block once the top has been sliced down. polygonOffset rather than
          a lift constant: it wins the depth test against the top face without
          being drawn at a depth it does not have. */}
      {wantField && built.field && (
        <group>
          <mesh geometry={built.field} raycast={() => null} renderOrder={1}>
            <meshStandardMaterial
              ref={fieldMat}
              vertexColors transparent opacity={0.9} side={THREE.DoubleSide}
              roughness={0.72} metalness={0.02}
              polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2}
            />
          </mesh>
          {built.fieldLine && (
            <lineSegments ref={flatLine} geometry={built.fieldLine} renderOrder={2}>
              <lineBasicMaterial color={CONTOUR} depthWrite={false} depthTest={false} />
            </lineSegments>
          )}
        </group>
      )}
    </>
  )
}
