// The proper name for a line of constant value, per variable.
//
// "Isotherm" and "isohaline" are both standard oceanographic terms, so naming
// them correctly is more precise than falling back to a generic "contour" —
// and a salinity section labelled "isotherms" is simply wrong.
const NAMES = { thetao: 'Isotherm', so: 'Isohaline' }

export function contourName(variable, plural = false) {
  const n = NAMES[variable] || 'Contour'
  return plural ? `${n}s` : n
}

// Contour and step values are round numbers off a ladder (2, 0.5, 0.05 ...),
// so print only the digits they actually carry rather than a fixed width.
export function fmtStep(v) {
  if (!Number.isFinite(v)) return ''
  return Number(v.toFixed(4)).toString()
}

// Decimals for an axis or a tick over a given span. A 25 °C range wants none;
// a 4 PSU range quantised to 0.25 needs two, or the ticks read 31.3 / 32.3 and
// hide the quarter steps they actually sit on.
export function spanDecimals(span) {
  if (!(span > 0)) return 2
  return span >= 12 ? 0 : span >= 6 ? 1 : 2
}
