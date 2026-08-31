// The isovalue slider's range, from the tile's OWN data.
//
// meta.valueMin/valueMax is the colour clamp. For temperature that is a fixed
// range wider than any one tile; for salinity it IS the tile's range. Either
// way the slider must stay inside what the volume can represent, because the
// RG8 buffer is normalised into that range and clipped there — an isovalue
// outside it selects nothing however much data sits beyond.
//
// Rounded INWARD to the step. Rounding out put both ends of the slider outside
// the data: 32.5 on a tile topping out at 32.39 crosses nothing, so the last
// stop always drew an empty surface. Every reachable position is now strictly
// inside the field.
const NICE_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1]
const POSITIONS = 90        // roughly how many stops the slider should offer

// A round step, chosen so the slider has a usable number of positions whatever
// the variable's span. A fixed 0.25 is right for a 23 °C range and useless for
// a 3.8 PSU one, which would give 15 stops.
function niceStep(span) {
  if (!(span > 0)) return NICE_STEPS[0]
  const want = span / POSITIONS
  return NICE_STEPS.reduce((a, b) => (
    Math.abs(Math.log(b) - Math.log(want)) < Math.abs(Math.log(a) - Math.log(want)) ? b : a
  ))
}

// Steps like 0.05 do not survive multiplication cleanly (626 * 0.05 =
// 31.300000000000004), and that lands on the slider as an unreachable value.
const snap = (v, step) => Number((Math.round(v / step) * step).toFixed(6))

export function isoRange(dataset) {
  const { dataMin, dataMax, valueMin, valueMax, variable } = dataset.meta.volume
  const lo0 = Math.max(valueMin, dataMin)
  const hi0 = Math.min(valueMax, dataMax)
  const step = niceStep(hi0 - lo0)

  const lo = Number((Math.ceil(lo0 / step) * step).toFixed(6))
  const hi = Number((Math.floor(hi0 / step) * step).toFixed(6))

  // 20 °C is the D20 thermocline proxy the spec names, so temperature opens
  // there when the tile contains it. Salinity has no equivalent single value
  // worth privileging — it opens at the middle of what the tile holds.
  const mid = snap((lo + hi) / 2, step)
  const start = variable === 'thetao' && 20 >= lo + step * 2 && 20 <= hi - step * 2
    ? 20
    : mid
  return { lo, hi, step, start }
}
