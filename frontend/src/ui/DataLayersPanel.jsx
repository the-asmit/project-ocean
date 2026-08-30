import Panel from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { IconCheck } from './icons.jsx'

// Observation networks INCOIS actually operates in this basin. None are wired
// to a feed yet, so every row says so rather than rendering an empty layer.
const OBSERVATIONS = [
  { key: 'argo', label: 'Argo floats', color: '#5ad18c' },
  { key: 'glider', label: 'Gliders', color: '#a98cf0' },
  { key: 'ctd', label: 'CTD stations', color: '#ffc46b' },
  { key: 'drifter', label: 'Drifters', color: '#4fc3f7' },
]

const TOOLS = ['Select region', 'Draw transect', 'Measure distance']

function Layer({ on, disabled, children, onClick, swatch, badge, title }) {
  return (
    <button
      type="button"
      className={`layer${on ? ' on' : ''}${disabled ? ' off' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={!disabled ? on : undefined}
      title={title}
    >
      <span className="tick"><IconCheck size={9} /></span>
      {swatch && <span className="swatch" style={{ background: swatch }} />}
      <span className="name">{children}</span>
      {badge && <span className="badge">{badge}</span>}
    </button>
  )
}

export default function DataLayersPanel({ dataset }) {
  const variable = useVisualizationState((s) => s.variable)
  const setVariable = useVisualizationState((s) => s.setVariable)
  const showDetail = useVisualizationState((s) => s.showDetail)
  const setShowDetail = useVisualizationState((s) => s.setShowDetail)
  const vars = dataset.meta.variables

  return (
    <>
      <Panel title="Data & layers" sub={dataset.meta.volume.source}>
        <div className="field">
          <span className="lbl">Ocean variables</span>
          <div className="layers">
            {Object.entries(vars).map(([key, v]) => (
              <Layer
                key={key}
                on={variable === key}
                disabled={!v.available}
                onClick={() => setVariable(key)}
                badge={v.available ? '3D' : 'SOON'}
                title={v.available ? `${v.label} (${v.units})` : `${v.label} — not wired to a feed yet`}
              >
                {v.label}
              </Layer>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="lbl">Bathymetry</span>
          <div className="layers">
            <Layer on disabled badge="REQUIRED" title="The seafloor bounds the block and terminates the cut faces — it cannot be hidden">
              Seafloor topography
            </Layer>
            <Layer
              on={showDetail}
              onClick={() => setShowDetail(!showDetail)}
              badge="STYLIZED"
              title="The block's top face is decorative shading, not imagery (P3). Turn it off for a plain lid."
            >
              Stylized top surface
            </Layer>
          </div>
        </div>

        <div className="field">
          <span className="lbl">Observations</span>
          <div className="layers">
            {OBSERVATIONS.map((o) => (
              <Layer key={o.key} disabled swatch={o.color} badge="SOON"
                title={`${o.label} — no feed connected yet`}>
                {o.label}
              </Layer>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Tools">
        <div className="layers" style={{ marginBottom: 10 }}>
          {TOOLS.map((t) => (
            <Layer key={t} disabled badge="SOON">{t}</Layer>
          ))}
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Until these ship: hover the 3D view to read a value, click to pin one.
          The transect follows the pinned point.
        </p>
      </Panel>
    </>
  )
}
