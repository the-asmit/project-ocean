// ===========================================================================
// THE colour definition. There is exactly one, and it lives here.
//
// It used to live in two places: a hardcoded transfer() in DioramaBlock's GLSL
// and a STOPS array in charts/sampling.js, kept in agreement by a comment that
// said "if transfer() changes, change this". That held while there was one
// palette. It would not survive four, so the shader now samples a 256-entry LUT
// TEXTURE built by this module from the same stops the charts read — the block,
// the isosurface, the glider ribbon, the section isolines, the profile knots
// and the colorbar swatch cannot disagree, because there is nothing left to
// disagree with.
//
// Stops are BYTES, not floats, because the CSS gradient, the chart strokes and
// the LUT are all byte-quantised in the end. Keeping the canonical form in the
// coarsest of the three means every consumer rounds identically instead of
// each rounding a float its own way.
// ===========================================================================

export const PALETTES = [
  {
    id: 'ocean',
    label: 'Ocean',
    note: 'The default. Sequential blue → green → yellow → red.',
    stops: [
      [8, 26, 107], [26, 140, 217], [89, 209, 140], [250, 217, 77], [235, 64, 38],
    ],
  },
  {
    id: 'viridis',
    label: 'Viridis',
    note: 'Perceptually uniform and colour-blind safe — equal steps in value are equal steps in apparent lightness.',
    stops: [
      [68, 1, 84], [72, 36, 117], [65, 68, 135], [53, 95, 141], [42, 120, 142],
      [33, 145, 140], [34, 168, 132], [68, 190, 112], [122, 209, 81],
      [189, 223, 38], [253, 231, 37],
    ],
  },
  {
    id: 'rdbu',
    label: 'Red–Blue',
    note: 'Diverging. Its pale midpoint sits at the middle of the DISPLAYED range — it is not a physical zero or an anomaly reference.',
    diverging: true,
    stops: [
      [33, 102, 172], [103, 169, 207], [209, 229, 240], [247, 247, 247],
      [253, 219, 199], [239, 138, 98], [178, 24, 43],
    ],
  },
  {
    id: 'mono',
    label: 'Mono',
    note: 'Lightness only. Reads on a greyscale print and leaves hue free for the overlaid layers.',
    stops: [
      [10, 12, 16], [58, 64, 74], [118, 126, 138], [186, 193, 203], [244, 247, 250],
    ],
  },
]

const BY_ID = new Map(PALETTES.map((p) => [p.id, p]))
export const DEFAULT_PALETTE = 'ocean'

export function palette(id) {
  return BY_ID.get(id) || BY_ID.get(DEFAULT_PALETTE)
}

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t)

// Position 0..1 along a palette -> [r, g, b] bytes. Stops are evenly spaced,
// which is what makes the diverging palette's midpoint land exactly at 0.5.
export function paletteRGB(id, t) {
  const { stops } = palette(id)
  const u = clamp01(t) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(u))
  const f = u - i
  const a = stops[i], b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

export function paletteCSS(id, dir = 'to top') {
  const { stops } = palette(id)
  return `linear-gradient(${dir}, ${stops.map((c) => `rgb(${c.join(',')})`).join(', ')})`
}

// The texture the shader samples. 256 RGBA bytes, built from paletteRGB at
// exactly the positions the shader asks for — see the (0.5 + p * 255) / 256
// texel-centre remap in DioramaBlock, which makes the two agree bit for bit.
export const LUT_SIZE = 256
export function paletteLUT(id) {
  const out = new Uint8Array(LUT_SIZE * 4)
  for (let i = 0; i < LUT_SIZE; i++) {
    const [r, g, b] = paletteRGB(id, i / (LUT_SIZE - 1))
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255
  }
  return out
}

// ---------------------------------------------------------------------------
// The scale: value -> position -> colour.
//
// WHY THE DISPLAY RANGE CANNOT WIDEN PAST THE BAKED ONE. The volume arrives as
// RG8, with R already normalised into [valueMin, valueMax] AND CLIPPED there by
// the backend at derive time. Everything outside that window was destroyed
// before it reached the browser. Narrowing inside it is exact to one 8-bit code
// (0.098 degC on the temperature clamp); widening would only paint flat bands
// and imply data that is not there. So a custom range is clamped to the baked
// one rather than silently lying about what it can show.
// ---------------------------------------------------------------------------

// Slider granularity for the range editor, from the span it covers.
export function rangeStep(span) {
  return span >= 12 ? 0.1 : span >= 6 ? 0.05 : 0.01
}

export function makeScale({ paletteId, valueMin, valueMax, range, log = false }) {
  const id = BY_ID.has(paletteId) ? paletteId : DEFAULT_PALETTE
  const step = rangeStep(valueMax - valueMin)
  // clamp to the baked window, then keep the two ends from collapsing onto
  // each other — a zero-width scale divides by zero and paints one colour
  let lo = Math.min(Math.max(range?.[0] ?? valueMin, valueMin), valueMax)
  let hi = Math.min(Math.max(range?.[1] ?? valueMax, valueMin), valueMax)
  if (hi - lo < step) {
    const mid = (lo + hi) / 2
    lo = Math.max(valueMin, mid - step / 2)
    hi = Math.min(valueMax, lo + step)
  }

  // Log needs a positive lower bound. The region picker accepts any box down to
  // 80S, and a polar tile really does carry sub-zero degC, so this is a live
  // case and not a theoretical one.
  const logOk = lo > 0
  const on = !!log && logOk
  const l0 = on ? Math.log(lo) : 0
  const l1 = on ? Math.log(hi) : 1

  const norm = on
    ? (value) => clamp01((Math.log(Math.max(value, 1e-9)) - l0) / (l1 - l0))
    : (value) => clamp01((value - lo) / (hi - lo))

  // Inverse, for placing tick labels: the bar is parameterised by POSITION, so
  // a log scale moves the labels rather than the gradient.
  const valueAt = on
    ? (p) => Math.exp(l0 + clamp01(p) * (l1 - l0))
    : (p) => lo + clamp01(p) * (hi - lo)

  return {
    paletteId: id,
    palette: palette(id),
    valueMin, valueMax, lo, hi, step,
    log: on,
    logRequested: !!log,
    logBlocked: !!log && !logOk,
    custom: lo > valueMin + 1e-9 || hi < valueMax - 1e-9,
    norm,
    valueAt,
    rgb: (value) => paletteRGB(id, norm(value)),
    css: (value) => {
      const c = paletteRGB(id, norm(value))
      return `rgb(${c[0]},${c[1]},${c[2]})`
    },
    gradient: paletteCSS(id),
    // What the shader needs, in the volume's own baked-normalised units.
    uniformRange: [
      (lo - valueMin) / (valueMax - valueMin),
      (hi - valueMin) / (valueMax - valueMin),
    ],
  }
}

// The colour definition, for tests and the console. Verification compares the
// LUT the GPU is handed against paletteRGB through this, so "one colour
// function" is a checkable claim rather than a comment.
if (import.meta.env.DEV) {
  window.__ramp = { PALETTES, palette, paletteRGB, paletteCSS, paletteLUT, makeScale, LUT_SIZE }
}
