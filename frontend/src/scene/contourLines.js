// Marching squares over a 2-D scalar grid — the threshold contour.
//
// The 3-D isosurface has marchingCubes.js; this is its 2-D sibling, and it is a
// separate file for the same reason: one algorithm, one place, so the 40 kJ/cm2
// line on the flat field and the 40 kJ/cm2 line draped over the D26 sheet are
// literally the same segment list evaluated at two heights, and cannot disagree
// about where the threshold is.
//
// NaN DISCIPLINE, same as the mesher's. A cell contributes only when all FOUR
// corners are finite. One land corner and the cell is skipped, so a contour is
// never interpolated between water and nothing. The line is left with an open
// end at the coast, which is the honest place for it to end.
//
// AMBIGUOUS CASES (5 and 10, the saddles) are resolved by the cell's own mean
// rather than picked arbitrarily — the standard asymptotic-decider-lite. Both
// choices are topologically valid; the mean is the one that keeps the contour
// consistent with the field it came from.
//
// Output is in FRACTIONAL GRID COORDINATES (i along lon, k along lat), not
// world space, so the caller places it — on a flat sheet at depth 0, or on a
// warped one at D26 — from the same numbers.

// case -> pairs of edges to join.
//   edge 0 = south (a->b)   1 = east (b->c)   2 = north (d->c)   3 = west (a->d)
// corners a(i,k) b(i+1,k) c(i+1,k+1) d(i,k+1); bit set = corner is ABOVE level.
const CASES = [
  [],           // 0  none above
  [[3, 0]],     // 1  a
  [[0, 1]],     // 2  b
  [[3, 1]],     // 3  a b
  [[1, 2]],     // 4  c
  null,         // 5  a c   — saddle
  [[0, 2]],     // 6  b c
  [[3, 2]],     // 7  a b c
  [[2, 3]],     // 8  d
  [[2, 0]],     // 9  a d
  null,         // 10 b d   — saddle
  [[2, 1]],     // 11 a b d
  [[1, 3]],     // 12 c d
  [[1, 0]],     // 13 a c d
  [[0, 3]],     // 14 b c d
  [],           // 15 all above
]

/**
 * @param field  Float32Array of W*D, index k*W + i, NaN where absent
 * @returns Float32Array [i0, k0, i1, k1, ...] — one segment per 4 entries,
 *          in row-major cell order (a south-to-north sweep, which is also the
 *          order the draw-in reveal walks).
 */
export function marchingSquares(field, W, D, level) {
  const out = []

  for (let k = 0; k < D - 1; k++) {
    for (let i = 0; i < W - 1; i++) {
      const a = field[k * W + i]
      const b = field[k * W + i + 1]
      const c = field[(k + 1) * W + i + 1]
      const d = field[(k + 1) * W + i]
      if (!(Number.isFinite(a) && Number.isFinite(b)
        && Number.isFinite(c) && Number.isFinite(d))) continue

      const code = (a > level ? 1 : 0) | (b > level ? 2 : 0)
        | (c > level ? 4 : 0) | (d > level ? 8 : 0)
      if (code === 0 || code === 15) continue

      // where the level crosses each edge, in fractional cell coordinates
      const t = (v0, v1) => (level - v0) / (v1 - v0)
      const edge = (e) => {
        switch (e) {
          case 0: return [i + t(a, b), k]
          case 1: return [i + 1, k + t(b, c)]
          case 2: return [i + t(d, c), k + 1]
          default: return [i, k + t(a, d)]
        }
      }

      let pairs = CASES[code]
      if (pairs === null) {
        // saddle: the cell mean decides which way the two branches connect
        const centre = (a + b + c + d) / 4 > level
        if (code === 5) pairs = centre ? [[3, 2], [0, 1]] : [[3, 0], [1, 2]]
        else pairs = centre ? [[2, 1], [0, 3]] : [[2, 3], [0, 1]]
      }
      for (const [e0, e1] of pairs) {
        const p = edge(e0), q = edge(e1)
        out.push(p[0], p[1], q[0], q[1])
      }
    }
  }
  return Float32Array.from(out)
}
