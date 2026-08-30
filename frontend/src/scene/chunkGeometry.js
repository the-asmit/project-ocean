import * as THREE from 'three'

// ===========================================================================
// The block's OUTER SHELL — a rugged, torn chunk of seafloor that has been cut
// clean through by two knife planes.
//
//                 z = +hz  (CUT: flat, real cross-section)
//         B ──────────────────── A
//         |                      |
//   torn  |        chunk         |  x = +hx  (CUT: flat, real cross-section)
//   shell |                      |
//         C ~~~~~~~~~~~~~~~~~~~~ D
//                 torn shell
//
// Everything the real temperature field is drawn on stays perfectly planar and
// sits on the data box's own boundary, so the cross-section, the isotherms and
// the depth ruler are geometrically identical to a plain wall. Only the two
// non-data sides, the base, and the top face's OUTLINE are displaced.
//
// Displacement is biased inward (bites torn out of the mass) rather than
// outward, so the top face never has to sample outside the tile.
// ===========================================================================

// Deterministic value noise. The chunk must be identical every frame and every
// reload for the same tile, so nothing here may use Math.random().
function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return h - Math.floor(h)
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy), b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1)
  const top = a + (b - a) * ux
  const bot = c + (d - c) * ux
  return top + (bot - top) * uy
}
function fbm(x, y) {
  let v = 0, amp = 0.5, fx = x, fy = y
  for (let i = 0; i < 4; i++) {
    v += amp * vnoise(fx, fy)
    const nx = fx * 1.6 + fy * 1.2
    const ny = -fx * 1.2 + fy * 1.6
    fx = nx; fy = ny; amp *= 0.5
  }
  return v
}

const smooth = (t) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

export const KIND = { SHELL: 0, CUT: 1, TOP: 2, BOTTOM: 3 }

// w, d      footprint spans — aspect-correct, from the region's lat/lon extent
// topY, botY  the DATA box in world Y; the cut faces span exactly this range
export function ruggedChunk(w, d, topY, botY, seed = 0) {
  const hx = w / 2, hz = d / 2
  const height = topY - botY
  const amp = Math.min(w, d) * 0.18          // horizontal tear amplitude
  const drop = height * 0.17                 // how far the torn base hangs

  const pos = [], nor = [], kinds = [], faceKind = []

  const tri = (a, b, c, n, k) => {
    pos.push(...a, ...b, ...c)
    for (let i = 0; i < 3; i++) { nor.push(...n); kinds.push(k) }
    faceKind.push(k)
  }
  // Wound so the outward side is the front face; FrontSide culls the other one,
  // which would make the face both invisible and un-raycastable.
  const quad = (a, b, c, e, n, k) => { tri(a, b, c, n, k); tri(a, c, e, n, k) }

  // Torn triangles get their true geometric normal, flipped outward if needed —
  // safer than trying to reason about winding through a noise field.
  const geoTri = (a, b, c, out, k) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    let n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ]
    const len = Math.hypot(n[0], n[1], n[2]) || 1
    n = [n[0] / len, n[1] / len, n[2] / len]
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) {
      tri(a, c, b, [-n[0], -n[1], -n[2]], k)
    } else {
      tri(a, b, c, n, k)
    }
  }

  // ---- the two knife cuts: plain planar quads on the data box boundary ----
  quad([-hx, botY, hz], [hx, botY, hz], [hx, topY, hz], [-hx, topY, hz],
    [0, 0, 1], KIND.CUT)
  quad([hx, botY, hz], [hx, botY, -hz], [hx, topY, -hz], [hx, topY, hz],
    [1, 0, 0], KIND.CUT)

  // ---- the torn perimeter: D -> C -> B (the -Z side, then the -X side) ----
  // Ring order around the top face is B, A, D, C — the same +Y winding a plain
  // top quad has — so the torn run is the D -> C -> B half of it.
  const SEG = 34
  const ring = []
  const push = (x, z, t) => ring.push({ x, z, t })

  push(hx, -hz, 0)                              // D — welded to the x=+hx cut
  for (let i = 1; i < SEG; i++) push(hx - w * (i / SEG), -hz, i / SEG)
  push(-hx, -hz, 1)                             // C — the free corner
  for (let i = 1; i < SEG; i++) push(-hx, -hz + d * (i / SEG), 1 - i / SEG)
  push(-hx, hz, 0)                              // B — welded to the z=+hz cut

  // arc length, so the noise runs continuously around the C corner
  let arc = 0
  ring[0].u = 0
  for (let i = 1; i < ring.length; i++) {
    arc += Math.hypot(ring[i].x - ring[i - 1].x, ring[i].z - ring[i - 1].z)
    ring[i].u = arc
  }
  // ~26 noise cells around the perimeter. Anything much smoother than this
  // reads as a tapered box rather than a broken one — the first pass used 7
  // and the result was a smoothly leaning slab, not a chunk.
  const nScale = 26 / arc

  // outward plan normal; C blends the two sides
  const outward = (p) => {
    const nx = p.x <= -hx + 1e-4 ? -1 : 0
    const nz = p.z <= -hz + 1e-4 ? -1 : 0
    const l = Math.hypot(nx, nz) || 1
    return [nx / l, nz / l]
  }

  // Zero displacement where the shell welds to a cut plane, so the knife faces
  // stay exactly rectangular and the section is never clipped or warped.
  const weld = (p) => smooth(p.t / 0.14)

  const ROWS = 18
  const layer = []
  for (let r = 0; r <= ROWS; r++) {
    const v = r / ROWS                          // 0 at the top face, 1 at the base
    const row = []
    for (const p of ring) {
      const [ox, oz] = outward(p)
      const n = fbm(p.u * nScale + seed, v * 4.2 + seed * 0.7)      // broad breaks
      const fine = fbm(p.u * nScale * 2.7 + 11, v * 9.5) - 0.5      // crumble
      // ridged noise: |n - 0.5| creases the surface into facets, and it is
      // subtracted so the creases cut INTO the mass like fracture planes
      const ridge = Math.abs(fbm(p.u * nScale * 1.35 + 31, v * 2.1) - 0.5) * 2
      const vProfile = 0.78 + 0.22 * Math.sin(Math.PI * Math.min(1, v * 1.1))
      const off = (amp * (n - 0.6) + amp * 0.42 * fine - amp * 0.3 * ridge)
        * weld(p) * vProfile
      // the base breaks away over the bottom fifth, not on one clean line
      const vb = Math.max(0, (v - 0.78) / 0.22)
      const dy = -drop * vb * (fbm(p.u * nScale * 0.9 + 4, 9) * 1.6 - 0.25) * weld(p)
      row.push([p.x + ox * off, topY - v * height + dy, p.z + oz * off])
    }
    layer.push(row)
  }

  for (let r = 0; r < ROWS; r++) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [ox, oz] = outward(ring[i])
      const out = [ox, 0, oz]
      const a = layer[r + 1][i], b = layer[r + 1][i + 1]
      const c = layer[r][i + 1], e = layer[r][i]
      geoTri(a, b, c, out, KIND.SHELL)
      geoTri(a, c, e, out, KIND.SHELL)
    }
  }

  // ---- top face: perfectly flat at topY, with an irregular OUTLINE --------
  const topRing = [[-hx, topY, hz], [hx, topY, hz]]
  for (let i = 0; i < ring.length; i++) topRing.push(layer[0][i])
  for (let i = 0; i < topRing.length; i++) {
    tri([0, topY, 0], topRing[i], topRing[(i + 1) % topRing.length],
      [0, 1, 0], KIND.TOP)
  }

  // ---- base: torn, hanging below the cut faces' straight bottom edge ------
  const botRing = [[-hx, botY, hz], [hx, botY, hz]]
  for (let i = 0; i < ring.length; i++) botRing.push(layer[ROWS][i])
  const bc = [0, botY - drop * 0.85, 0]
  for (let i = 0; i < botRing.length; i++) {
    geoTri(bc, botRing[(i + 1) % botRing.length], botRing[i],
      [0, -1, 0], KIND.BOTTOM)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1))
  g.userData.faceKind = Uint8Array.from(faceKind)
  g.computeBoundingSphere()
  return g
}


// The knife edges, drawn crisply so the cut reads as deliberate against the
// torn shell — the whole point of the sliced-tennis-ball silhouette.
export function cutOutline(w, d, topY, botY) {
  const hx = w / 2, hz = d / 2
  const p = []
  const seg = (a, b) => p.push(...a, ...b)
  const A = [hx, topY, hz], B = [-hx, topY, hz], D = [hx, topY, -hz]
  const Ab = [hx, botY, hz], Bb = [-hx, botY, hz], Db = [hx, botY, -hz]
  seg(B, A); seg(A, D)
  seg(Bb, Ab); seg(Ab, Db)
  seg(A, Ab); seg(B, Bb); seg(D, Db)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  return g
}
