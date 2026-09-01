// ===========================================================================
// D26 and TROPICAL CYCLONE HEAT POTENTIAL — OPERATIONAL_LAYER_SPEC.md §3.
//
// The one operational parameter that matters more than sea-surface temperature
// for cyclone intensification, and the one a 2D SST map physically cannot
// carry: the *depth* of the warm layer and the heat stored in it.
//
//   D26  = depth where temperature crosses 26 degC going down, linearly
//          interpolated between the two bracketing model levels
//   TCHP = rho * c_p * integral[0 -> D26] (T - 26) dz,  reported in kJ/cm2
//
// NO NEW DATA. This walks `dataset.rg8` — the same Uint8Array the 3D texture
// was uploaded from, the CPU sampler interpolates and the marching-tetrahedra
// mesher reads. One pass over 73x73x31 bytes, once per tile, memoised on the
// dataset object. There is no endpoint behind this and no fetch.
//
// VALIDITY. Gated on G >= 128, the true mask. R is dilate-filled so trilinear
// filtering near a coastline never blends into garbage; G is not, and G is what
// decides whether a level exists. The first invalid level ENDS the column,
// because below the seafloor there is no more water — that is the physical
// reading of the mask, not a shortcut.
//
// WHAT THE 8-BIT VOLUME COSTS, MEASURED. thetao is baked against a fixed
// [8, 33] degC clamp, so one code is 0.098 degC. Running this exact algorithm
// against the float64 source NetCDF (backend/verify_tchp.py) over the bengal
// tile on 2019-05-01:
//
//     TCHP   mean 0.26   p95 0.71   max 1.36 kJ/cm2   (on values of 20-172)
//     D26    mean 0.20   p95 0.47   max 7.76 m
//     columns that change side of the 40 kJ/cm2 line: 1 of 4,049
//
// The 7.76 m D26 outlier is not noise in the field, it is the crossing being
// ill-conditioned: on a near-isothermal column dT/dz approaches zero and the
// interpolated crossing depth swings on a fraction of a degree. Where the
// profile has a real thermocline — which is everywhere that matters for this
// quantity — the error is sub-metre. The panel says so rather than quoting
// only the mean.
//
// ON THE CONSTANTS. rho = 1026 kg/m3 and c_p = 3990 J/(kg.degC) are the
// standard values for the DIRECT DEPTH-INTEGRAL method, which is the right
// method when you hold full temperature profiles, which we do. Other products
// use different conventions (NOAA's altimetry method references 20 degC), so
// the absolute kJ/cm2 here is a physically-grounded estimate and will not match
// a specific INCOIS product to the decimal. The spatial pattern and which side
// of the threshold a column falls on are the robust claims, and are the ones
// the UI makes.
// ===========================================================================

export const RHO = 1026            // kg/m3, upper-ocean seawater
export const CP = 3990             // J/(kg.degC)
export const T26 = 26              // degC, the isotherm that defines the layer

// rho*c_p*[degC.m] is J/m2; 1 J/m2 = 1e-3 kJ / 1e4 cm2 = 1e-7 kJ/cm2
export const KJ_CM2_PER_DEGC_M = RHO * CP * 1e-7      // 0.409374

// The commonly-cited Bay of Bengal figure for cyclone-intensification-favourable
// upper-ocean heat content. Widely used and sound; the precise number and its
// source should be confirmed against current INCOIS/IMD literature before it
// goes on a slide, which is what the spec itself asks for.
export const THRESHOLD = 40        // kJ/cm2

// FIXED colour domain, for the same reason thetao carries a fixed clamp: a
// colour has to mean the same heat content on every tile, and the threshold has
// to sit at the same place on the ramp every time. Measured maximum across five
// pre-monsoon Bay tiles was 180.1 kJ/cm2.
export const TCHP_MAX = 200        // kJ/cm2 at the top of the ramp

// One variable is loaded at a time, and this is arithmetic on the temperature
// volume. On salinity the layer says so rather than quietly fetching thetao.
export function heatPotentialAvailable(dataset) {
  return dataset?.meta?.volume?.variable === 'thetao'
}

/**
 * @param dataset  loaded dataset ({ meta, rg8, map })
 * @returns {{
 *   W, D,                       grid, i = lon, k = lat, index k*W + i
 *   d26: Float32Array,          metres, NaN where there is no warm layer
 *   tchp: Float32Array,         kJ/cm2, NaN over land, 0 where the surface <= 26
 *   censored: Uint8Array,       1 where the warm layer runs past the deepest
 *                               valid level — D26 is a LOWER BOUND there
 *   stats, ms
 * }}
 */
export function computeHeatPotential(dataset) {
  const t0 = performance.now()
  const v = dataset.meta.volume
  const { W, H, D, levelsReal: HR, depthLevels, valueMin, valueMax } = v
  const rg8 = dataset.rg8
  const span = valueMax - valueMin

  const d26 = new Float32Array(W * D).fill(NaN)
  const tchp = new Float32Array(W * D).fill(NaN)
  const censored = new Uint8Array(W * D)

  // scratch for one column, reused
  const t = new Float64Array(HR)
  const z = new Float64Array(HR)

  let water = 0, warm = 0, over = 0, cens = 0, cold = 0

  for (let k = 0; k < D; k++) {
    for (let i = 0; i < W; i++) {
      // read the column down to the first invalid level
      let n = 0
      for (let j = 0; j < HR; j++) {
        const o = ((k * H + j) * W + i) * 2
        if (rg8[o + 1] < 128) break
        t[n] = valueMin + (rg8[o] / 255) * span
        z[n] = depthLevels[j]
        n++
      }
      if (n === 0) continue                     // land: no surface cell at all
      const idx = k * W + i
      water++

      // No warm layer to integrate. TCHP is 0, not missing — the column exists
      // and holds no cyclone fuel. D26 stays NaN: there is no 26 degC crossing
      // to report, and 0 m would read as one.
      if (t[0] <= T26) { tchp[idx] = 0; cold++; continue }
      warm++

      // Nothing exists above the model's shallowest level (~0.49 m), so its
      // value is held constant up to the surface rather than extrapolated.
      let acc = (t[0] - T26) * z[0]
      let crossed = false

      for (let j = 0; j < n - 1; j++) {
        if (t[j + 1] > T26) {
          // both ends warm: ordinary trapezoid over the layer
          acc += 0.5 * ((t[j] - T26) + (t[j + 1] - T26)) * (z[j + 1] - z[j])
          continue
        }
        // the crossing, linearly interpolated between the bracketing levels
        const f = (t[j] - T26) / (t[j] - t[j + 1])
        const dz = z[j] + f * (z[j + 1] - z[j])
        // the last partial layer is a triangle: (T-26) falls to 0 at D26
        acc += 0.5 * (t[j] - T26) * (dz - z[j])
        d26[idx] = dz
        crossed = true
        break
      }

      if (!crossed) {
        // Warm all the way to the deepest valid level — the seafloor on the
        // shelf, or the volume's own 454 m extent offshore. D26 is a LOWER
        // BOUND, and every readout has to say so.
        d26[idx] = z[n - 1]
        censored[idx] = 1
        cens++
      }
      tchp[idx] = acc * KJ_CM2_PER_DEGC_M
      if (tchp[idx] >= THRESHOLD) over++
    }
  }

  return {
    W, D, d26, tchp, censored,
    stats: {
      water, warm, cold, over, censored: cens,
      overFraction: water ? over / water : 0,
      d26Min: minOf(d26), d26Max: maxOf(d26),
      tchpMin: minOf(tchp), tchpMax: maxOf(tchp),
    },
    ms: performance.now() - t0,
  }
}

function minOf(a) {
  let m = Infinity
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && a[i] < m) m = a[i]
  return Number.isFinite(m) ? m : null
}
function maxOf(a) {
  let m = -Infinity
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && a[i] > m) m = a[i]
  return Number.isFinite(m) ? m : null
}

/**
 * Bilinear read at a geographic position, for the cursor readout.
 *
 * Goes through `dataset.map` and then the volume's own (W, D) grid, exactly the
 * way makeSampler() does, so a TCHP number and a temperature number under the
 * same cursor are describing the same cell. A cell with any missing corner
 * returns null rather than a partial average — a heat content averaged over
 * land is not a smaller heat content, it is a wrong one.
 */
export function sampleHeat(heat, map, lon, lat) {
  if (!heat) return null
  const { W, D, d26, tchp, censored } = heat
  const x = map.lonToX(lon)
  const z = map.latToZ(lat)
  const u = (x / map.spanX + 0.5) * (W - 1)
  const w = (z / map.spanZ + 0.5) * (D - 1)
  if (!(u >= 0 && u <= W - 1 && w >= 0 && w <= D - 1)) return null

  const i0 = Math.min(W - 2, Math.floor(u)), tx = u - i0
  const k0 = Math.min(D - 2, Math.floor(w)), tz = w - k0
  const n = [k0 * W + i0, k0 * W + i0 + 1, (k0 + 1) * W + i0, (k0 + 1) * W + i0 + 1]
  const wt = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz]

  let heatV = 0, depthV = 0, depthW = 0, anyCensored = false
  for (let c = 0; c < 4; c++) {
    const q = tchp[n[c]]
    if (!Number.isFinite(q)) return null           // a land corner: no reading
    heatV += q * wt[c]
    const dv = d26[n[c]]
    if (Number.isFinite(dv)) { depthV += dv * wt[c]; depthW += wt[c] }
    if (censored[n[c]]) anyCensored = true
  }
  return {
    tchp: heatV,
    d26: depthW > 0.5 ? depthV / depthW : null,
    censored: anyCensored,
    over: heatV >= THRESHOLD,
  }
}
