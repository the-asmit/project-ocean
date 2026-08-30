import Panel from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { RAMP_CSS } from '../charts/sampling.js'

// The ramp is shared with the shader's transfer() and with the chart colours,
// so a voxel, an isotherm and this bar all mean the same thing at the same value.
export default function Colorbar({ dataset }) {
  const variable = useVisualizationState((s) => s.variable)
  const v = dataset.meta.volume
  const info = dataset.meta.variables[variable]
  const lo = v.valueMin
  const hi = v.valueMax
  const ticks = [1, 0.75, 0.5, 0.25, 0]

  return (
    <Panel title="Scale" sub={`${info.label} · ${info.units}`}>
      <div className="cbar">
        <div className="bar" style={{ background: RAMP_CSS, height: 132 }} />
        <div className="ticks" style={{ height: 132 }}>
          {ticks.map((t) => (
            <span key={t} style={{ top: `${(1 - t) * 100}%` }}>
              {(lo + t * (hi - lo)).toFixed(0)}
            </span>
          ))}
        </div>
      </div>
      <div className="cbar-foot">
        <span>in tile</span>
        <span>{v.dataMin.toFixed(1)}–{v.dataMax.toFixed(1)} {info.units}</span>
      </div>
    </Panel>
  )
}
