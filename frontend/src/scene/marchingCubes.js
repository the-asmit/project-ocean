import * as THREE from 'three'

// Isosurface extraction over the SAME RG8 volume everything else reads.
//
// No new fetch and no resampling: this walks `dataset.rg8` at its native grid
// corners, which is exactly the buffer makeSampler() interpolates and the
// shader uploads. Going through sampler() would interpolate twice — marching
// does its own interpolation between corners, which is the whole algorithm.
//
// WHY IT MARCHES IN INDEX SPACE. The 31 GLORYS levels run 0.5 m to 453.9 m
// with 0.5 m spacing at the top and 74 m at the bottom. A crossing between
// levels j and j+1 therefore yields a FRACTIONAL LEVEL, which is lerped
// through depthLevels[] into real metres and only then placed with the block's
// own yOfDepthM(). Marching in world space would misplace the surface
// everywhere the levels are unevenly spaced, which is everywhere.
//
// WHY TETRAHEDRA, NOT THE 256-CASE CUBE TABLE. Each cube is split into six
// tetrahedra sharing the 0-6 diagonal (Kuhn's decomposition). Every tet has
// only three topological cases — nothing, one corner cut off, or a quad — so
// the algorithm is correct by construction rather than by the fidelity of a
// 4096-entry transcribed table, where a single wrong row is a hole or a spike
// that no screenshot reliably catches. Neighbouring cubes split their shared
// face along the same diagonal (verified for all three axes), so the mesh is
// watertight. The cost is ~2x the triangles of cube marching, which at this
// grid's ~5k active cells is nothing.
//
// VALIDITY. A cell is meshed only when all EIGHT corners carry G >= 128. One
// invalid corner and the whole cell is skipped, so no triangle is ever
// interpolated across a land or seafloor boundary. The surface is left with a
// ragged open edge at the shelf and at the 454 m floor. That edge is the
// honest answer, not a hole to be patched.

// cube corner -> [di, dj, dk] with i=lon, j=level, k=lat
const CORNER = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
]

// Six tetrahedra, every one containing the 0-6 main diagonal. Uniform across
// all cubes, which is what makes shared faces agree.
const TETS = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
]

// The two "inside" corners for each 2-vs-2 tet case, in mask order.
const PAIR = { 3: [0, 1], 5: [0, 2], 6: [1, 2], 9: [0, 3], 10: [1, 3], 12: [2, 3] }

// Point-in-polygon in the XZ plane against the chunk's torn perimeter.
//
// The shell is displaced INWARD in places, so it is narrower than the data box
// it wraps. A surface drawn at the tile's full extent therefore pokes out
// through the rock as a coloured fin. The rings chunkGeometry already
// publishes are the shell's true silhouette, so the surface is clipped to
// them — read-only, nothing about the shell changes. Top and bottom rings are
// lerped by the vertex's own height, because the tear narrows with depth.
function makeInsideShell(rings, topY, botY) {
  if (!rings) return null
  const { top, bot } = rings
  const n = Math.min(top.length, bot.length)
  const span = topY - botY || 1
  return (x, y, z) => {
    const t = Math.min(1, Math.max(0, (topY - y) / span))
    let inside = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = top[i][0] + (bot[i][0] - top[i][0]) * t
      const zi = top[i][2] + (bot[i][2] - top[i][2]) * t
      const xj = top[j][0] + (bot[j][0] - top[j][0]) * t
      const zj = top[j][2] + (bot[j][2] - top[j][2]) * t
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
    }
    return inside
  }
}

/**
 * @param dataset  loaded dataset (meta, rg8, map)
 * @param opts.isoValue  in real units (deg C)
 * @param opts.yOfDepthM depth metres -> world Y, from blockLayout
 * @param opts.iMin      first surviving lon column (the west cut)
 * @param opts.jMin      first surviving level (the depth cut)
 * @returns { geometry, triangles, vertices, cellsActive, cellsMasked, ms } | null
 */
export function isosurfaceGeometry(dataset, { isoValue, yOfDepthM, iMin = 0, jMin = 0, shell = null }) {
  const t0 = performance.now()
  const { W, H, D, levelsReal: HR, valueMin, valueMax, depthLevels } = dataset.meta.volume
  const { spanX, spanZ } = dataset.map
  const rg8 = dataset.rg8

  // the isovalue in the buffer's own normalised 0..1 units
  const iso = (isoValue - valueMin) / (valueMax - valueMin)
  if (!(iso > 0) || !(iso < 1)) return null

  const NC = W * H * D
  const idx = (i, j, k) => (k * H + j) * W + i
  const val = (o) => rg8[o * 2] / 255
  const ok = (o) => rg8[o * 2 + 1] >= 128

  const dxi = spanX / (W - 1)
  const dzk = spanZ / (D - 1)
  // world Y of each real model level, at the CURRENT exaggeration
  const yLev = new Float64Array(HR)
  for (let j = 0; j < HR; j++) yLev[j] = yOfDepthM(depthLevels[j])

  const inShell = shell ? makeInsideShell(shell.rings, shell.topY, shell.botY) : null
  const insideCache = new Map()

  const pos = []
  const nrm = []
  const tri = []
  const cache = new Map()          // edge key -> vertex index
  let cellsActive = 0
  let cellsMasked = 0

  // --- normals from the field gradient -----------------------------------
  // Not from triangle winding: welded vertices with inconsistent winding
  // average to garbage, and the gradient is the surface's true normal anyway.
  // Central differences in index space, divided by the world spacing on each
  // axis — the depth spacing being the non-uniform one. Invalid neighbours
  // fall back to a one-sided difference so the mask never leaks in as a spike.
  const gcache = new Map()
  function gradAt(i, j, k) {
    const key = idx(i, j, k)
    const hit = gcache.get(key)
    if (hit !== undefined) return hit
    const c = val(key)
    const ax = (a, b, o, span) => {
      const oa = a >= 0 && ok(a), ob = b >= 0 && ok(b)
      if (oa && ob) return (val(b) - val(a)) / (2 * span)
      if (ob) return (val(b) - c) / span
      if (oa) return (c - val(a)) / span
      return 0
    }
    const gx = ax(i > 0 ? idx(i - 1, j, k) : -1, i < W - 1 ? idx(i + 1, j, k) : -1, 0, dxi)
    const gz = ax(k > 0 ? idx(i, j, k - 1) : -1, k < D - 1 ? idx(i, j, k + 1) : -1, 0, dzk)
    // vertical spacing is the local one, in world units
    const jl = Math.max(0, j - 1), jh = Math.min(HR - 1, j + 1)
    const dy = (yLev[jh] - yLev[jl]) / Math.max(1, jh - jl)
    const gy = ax(j > 0 ? idx(i, j - 1, k) : -1, j < HR - 1 ? idx(i, j + 1, k) : -1, 0, Math.abs(dy) || 1)
      * Math.sign(dy || -1)
    const g = [gx, gy, gz]
    gcache.set(key, g)
    return g
  }

  // --- one vertex per grid EDGE, welded -----------------------------------
  // The crossing point on an edge depends only on its two endpoint values, so
  // every tet sharing that edge computes the same position. Keying on the edge
  // therefore welds exactly, with no epsilon compare.
  function edgeVertex(a, b) {
    const key = a < b ? a * NC + b : b * NC + a
    const hit = cache.get(key)
    if (hit !== undefined) return hit

    const va = val(a), vb = val(b)
    let t = vb === va ? 0.5 : (iso - va) / (vb - va)
    t = t < 0 ? 0 : t > 1 ? 1 : t

    const ai = a % W, aj = Math.floor(a / W) % H, ak = Math.floor(a / (W * H))
    const bi = b % W, bj = Math.floor(b / W) % H, bk = Math.floor(b / (W * H))
    const fi = ai + (bi - ai) * t
    const fj = aj + (bj - aj) * t
    const fk = ak + (bk - ak) * t

    // fractional level -> real metres -> world Y through the block's own map
    const j0 = Math.min(HR - 2, Math.floor(fj))
    const m = depthLevels[j0] + (depthLevels[j0 + 1] - depthLevels[j0]) * (fj - j0)

    const v = pos.length / 3
    pos.push((fi / (W - 1) - 0.5) * spanX, yOfDepthM(m), (fk / (D - 1) - 0.5) * spanZ)

    const ga = gradAt(ai, aj, ak), gb = gradAt(bi, bj, bk)
    let nx = -(ga[0] + (gb[0] - ga[0]) * t)
    let ny = -(ga[1] + (gb[1] - ga[1]) * t)
    let nz = -(ga[2] + (gb[2] - ga[2]) * t)
    const len = Math.hypot(nx, ny, nz) || 1
    nrm.push(nx / len, ny / len, nz / len)

    cache.set(key, v)
    return v
  }

  // Emit a triangle wound to AGREE with the gradient normals.
  //
  // Tet marching gives no winding guarantee on its own, and DoubleSide flips
  // the shading normal on back-facing triangles — so a mesh with mixed winding
  // lights adjacent triangles from opposite sides and reads as a corrugated
  // quilt even when the geometry is correct to centimetres. Orienting each
  // face against the stored normals costs one cross product and removes it.
  function pushTri(a, b, c) {
    if (inShell) {
      // a triangle is kept only if the whole of it is inside the shell, so the
      // surface stops at the rock rather than crossing it
      for (const v of [a, b, c]) {
        let ok2 = insideCache.get(v)
        if (ok2 === undefined) {
          ok2 = inShell(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
          insideCache.set(v, ok2)
        }
        if (!ok2) return
      }
    }
    const x0 = pos[a * 3], y0 = pos[a * 3 + 1], z0 = pos[a * 3 + 2]
    const ux = pos[b * 3] - x0, uy = pos[b * 3 + 1] - y0, uz = pos[b * 3 + 2] - z0
    const vx = pos[c * 3] - x0, vy = pos[c * 3 + 1] - y0, vz = pos[c * 3 + 2] - z0
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    const nx = nrm[a * 3] + nrm[b * 3] + nrm[c * 3]
    const ny = nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1]
    const nz = nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]
    if (fx * nx + fy * ny + fz * nz < 0) tri.push(a, c, b)
    else tri.push(a, b, c)
  }

  // --- the march ----------------------------------------------------------
  const co = new Int32Array(8)
  const cv = new Float64Array(4)
  const ci = new Int32Array(4)

  for (let k = 0; k < D - 1; k++) {
    for (let j = jMin; j < HR - 1; j++) {
      for (let i = iMin; i < W - 1; i++) {
        let bad = false
        for (let c = 0; c < 8; c++) {
          const o = idx(i + CORNER[c][0], j + CORNER[c][1], k + CORNER[c][2])
          if (!ok(o)) { bad = true; break }
          co[c] = o
        }
        if (bad) { cellsMasked++; continue }

        let any = false
        for (let t = 0; t < 6; t++) {
          const T = TETS[t]
          let mask = 0
          for (let c = 0; c < 4; c++) {
            ci[c] = co[T[c]]
            cv[c] = val(ci[c])
            if (cv[c] > iso) mask |= 1 << c
          }
          if (mask === 0 || mask === 15) continue
          any = true

          const n = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)
          if (n === 1 || n === 3) {
            // one corner cut off: a single triangle on its three edges
            const lone = n === 1
              ? Math.log2(mask) | 0
              : Math.log2(15 ^ mask) | 0
            const o = [0, 1, 2, 3].filter((c) => c !== lone)
            pushTri(
              edgeVertex(ci[lone], ci[o[0]]),
              edgeVertex(ci[lone], ci[o[1]]),
              edgeVertex(ci[lone], ci[o[2]]),
            )
          } else {
            // two against two: a quad across the four crossing edges
            const [a0, a1] = PAIR[mask]
            const [b0, b1] = [0, 1, 2, 3].filter((c) => c !== a0 && c !== a1)
            const p00 = edgeVertex(ci[a0], ci[b0])
            const p01 = edgeVertex(ci[a0], ci[b1])
            const p11 = edgeVertex(ci[a1], ci[b1])
            const p10 = edgeVertex(ci[a1], ci[b0])
            pushTri(p00, p01, p11)
            pushTri(p00, p11, p10)
          }
        }
        if (any) cellsActive++
      }
    }
  }

  if (!tri.length) return null

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(nrm), 3))
  g.setIndex(tri)
  g.computeBoundingSphere()

  return {
    geometry: g,
    triangles: tri.length / 3,
    vertices: pos.length / 3,
    cellsActive,
    cellsMasked,
    ms: performance.now() - t0,
  }
}

// How the two cuts bound the surface. THEY ARE NOT SYMMETRIC, and the reason
// is what the feature is for.
//
// SLICE FROM TOP removes material ABOVE the surface, so trimming to it would
// delete the surface exactly as the user uncovers it. Dragging the top cut down
// past the thermocline is the whole interaction: the surface emerges from the
// block into open air above the new top face, lit and correctly occluded.
// So the depth cut does not trim — it reveals.
//
// SLICE FROM WEST removes a whole vertical wall. Anything left beyond it would
// hang in space with no block under it and would sit in front of the N-S
// section the cut just exposed, so that one does trim, exactly at the same
// column the block rebuilds to.
export function cutBounds(dataset, L) {
  const { W } = dataset.meta.volume
  const iMin = Math.max(0, Math.ceil((L.xWest / dataset.map.spanX + 0.5) * (W - 1)))
  return { iMin: Math.min(iMin, W - 2), jMin: 0 }
}
