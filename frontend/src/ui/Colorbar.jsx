import Panel from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { RAMP_CSS } from '../charts/sampling.js'
import { spanDecimals } from './variableTerms.js'

// The ramp is shared with the shader's transfer() and with the chart colours,
// so a voxel, an isotherm and this bar all mean the same thing at the same value.
export default function Colorbar({ dataset }) {
  const variable = useVisualizationState((s) => s.variable)
  const v = dataset.meta.volume
  const info = dataset.meta.variables[variable]
  const lo = v.valueMin
  const hi = v.valueMax
  const ticks = [1, 0.75, 0.5, 0.25, 0]
  // A 25 °C range reads fine as whole degrees; a 4 PSU range quantised to a
  // quarter would print 31.3 / 32.3 and hide the steps it actually sits on.
  const dp = spanDecimals(hi - lo)
  const fitted = v.rangeMode === 'tile'

  return (
    <Panel title="Scale" sub={`${info.label} · ${info.units}`}>
      <div className="cbar">
        <div className="bar" style={{ background: RAMP_CSS, height: 132 }} />
        <div className="ticks" style={{ height: 132 }}>
          {ticks.map((t) => (
            <span key={t} style={{ top: `${(1 - t) * 100}%` }}>
              {(lo + t * (hi - lo)).toFixed(dp)}
            </span>
          ))}
        </div>
      </div>
      <div className="cbar-foot">
        <span>in tile</span>
        <span>{v.dataMin.toFixed(dp)}–{v.dataMax.toFixed(dp)} {info.units}</span>
      </div>
      {/* The two variables use different range policies, and that changes what
          a colour MEANS. Stating it here rather than in a tooltip, because a
          reader comparing two tiles by eye has to know which case they are in. */}
      <div className={`scale-mode${fitted ? ' fitted' : ''}`}>
        <span className="badge">{fitted ? 'FITTED TO TILE' : 'FIXED SCALE'}</span>
        <span>
          {fitted
            ? `Scale is this tile's own ${v.dataMin.toFixed(1)}–${v.dataMax.toFixed(1)} range — salinity is set by geography, so colours are NOT comparable with another tile.`
            : `Same ${lo.toFixed(0)}–${hi.toFixed(0)} ${info.units} scale on every tile — colours are comparable between tiles.`}
        </span>
      </div>
    </Panel>
  )
}
