// The isovalue slider's range, from the tile's OWN data.
//
// meta.valueMin/valueMax are the fixed colorbar clamp (8-31 degC for thetao),
// which is deliberately wider than any one tile. Offering the user a value the
// tile never reaches would hand them an empty surface with nothing to explain
// it, so the slider is bounded by dataMin/dataMax, rounded outward to a clean
// half-degree.
//
// The opening value is 20 degC where the tile contains it: D20, the depth of
// the 20 degC isotherm, is the standard thermocline proxy in this basin and is
// the value the spec names. Where the tile does not reach it, the midpoint of
// what it does have.
export function isoRange(dataset) {
  const { dataMin, dataMax } = dataset.meta.volume
  const lo = Math.floor(dataMin * 2) / 2
  const hi = Math.ceil(dataMax * 2) / 2
  const start = 20 >= lo + 0.5 && 20 <= hi - 0.5 ? 20 : Math.round((lo + hi)) / 2
  return { lo, hi, step: 0.25, start }
}
