import { useVisualizationState } from '../state/useVisualizationState.js'
import { useHeatPotential } from '../state/useHeatPotential.js'
import { THRESHOLD, TCHP_MAX } from '../scene/heatPotential.js'
import { paletteCSS } from '../scene/colorScale.js'

// Provenance and scale for the cyclone layer, on the canvas itself — the same
// place and the same idiom as the REAL CURRENTS chip, so a screenshot of the 3D
// view alone still says what the colours mean and where they came from.
//
// The ramp is FIXED at 0–200 kJ/cm² whatever the tile holds, so the threshold
// tick sits at the same place on the bar every time and two tiles can be
// compared by colour. That is the same argument the backend makes for the
// temperature clamp, and it is why this legend has no per-tile numbers on it.

export default function HeatLegend({ dataset }) {
  const showHeat = useVisualizationState((s) => s.showHeat)
  const paletteId = useVisualizationState((s) => s.palette)
  const heat = useHeatPotential(dataset)
  if (!showHeat || !heat) return null

  const pct = (THRESHOLD / TCHP_MAX) * 100

  return (
    <div className="heat-chip">
      <div className="hc-head">
        DERIVED
        <em>cyclone heat potential · from the loaded {dataset.meta.volume.variable} volume</em>
      </div>
      <div className="hc-bar" style={{ background: paletteCSS(paletteId, 'to right') }}>
        <i className="hc-tick" style={{ left: `${pct}%` }} />
      </div>
      <div className="hc-scale">
        <span>0</span>
        <span className="hc-thresh" style={{ left: `${pct}%` }}>{THRESHOLD}</span>
        <span>{TCHP_MAX} kJ/cm²</span>
      </div>
      <div className="hc-key">
        <i className="hc-line" />
        {THRESHOLD} kJ/cm² — cyclone-intensification threshold
      </div>
    </div>
  )
}
