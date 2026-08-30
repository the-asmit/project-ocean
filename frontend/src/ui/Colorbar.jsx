import { useVisualizationState } from '../state/useVisualizationState.js'

// Matches the shader's transfer() stops exactly — same five colours, same
// positions. If transfer() changes, change this.
const STOPS = [
  'rgb(8,26,107)', 'rgb(26,140,217)', 'rgb(89,209,140)',
  'rgb(250,217,77)', 'rgb(235,64,38)',
]
const GRAD = `linear-gradient(to top, ${STOPS.join(', ')})`

export default function Colorbar({ dataset }) {
  const variable = useVisualizationState((s) => s.variable)
  const selected = useVisualizationState((s) => s.selected)
  const v = dataset.meta.volume
  const info = dataset.meta.variables[variable]

  const lo = v.valueMin
  const hi = v.valueMax
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className={`card overlay colorbar${selected ? ' shifted' : ''}`}>
      <div className="h-label" style={{ textAlign: 'center' }}>{info.label}</div>
      <div className="scale">
        <div className="bar" style={{ background: GRAD }} />
        <div className="ticks">
          {ticks.map((t) => (
            <span key={t} style={{ top: `${(1 - t) * 100}%` }}>
              {(lo + t * (hi - lo)).toFixed(1)}
            </span>
          ))}
        </div>
      </div>
      <div className="h-label cap">{info.units}</div>
      <div className="h-label cap" style={{ marginTop: 6, opacity: 0.75 }}>
        data {v.dataMin.toFixed(1)}–{v.dataMax.toFixed(1)}
      </div>
    </div>
  )
}
