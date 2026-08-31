import Panel from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { IconCheck } from './icons.jsx'
import { useSpikeState } from '../spike/useSpikeState.js'

// Observation networks INCOIS actually operates in this basin. None are wired
// to a feed yet, so every row says so rather than rendering an empty layer.
const OBSERVATIONS = [
  { key: 'glider', label: 'Gliders', color: '#a98cf0' },
  { key: 'ctd', label: 'CTD stations', color: '#ffc46b' },
  { key: 'drifter', label: 'Drifters', color: '#4fc3f7' },
]

// Region select is the map's drag behaviour and genuinely works, so it is not
// badged SOON — that would be a claim the user can disprove in one click.
const TOOLS = ['Draw transect', 'Measure distance']

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
  const showArgo = useVisualizationState((s) => s.showArgo)
  const setShowArgo = useVisualizationState((s) => s.setShowArgo)
  const showDetail = useVisualizationState((s) => s.showDetail)
  const showCurrents = useSpikeState((s) => s.showCurrents)
  const setShowCurrents = useSpikeState((s) => s.setShowCurrents)
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
            {/* Argo runs through the ObservationSource interface. The data
                behind it is a mock, so it is badged MOCK, never SOON and never
                unmarked — a fake profile beside a model curve has to say so. */}
            <Layer
              on={showArgo} swatch="#84a9c0" badge="MOCK"
              onClick={() => setShowArgo(!showArgo)}
              title="Synthetic Argo floats through the ObservationSource interface — click a float in the 3D view to compare it against the model"
            >
              Argo floats
            </Layer>
            {OBSERVATIONS.map((o) => (
              <Layer key={o.key} disabled swatch={o.color} badge="SOON"
                title={`${o.label} — no feed connected yet`}>
                {o.label}
              </Layer>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Experimental" sub="mechanism spike">
        <div className="layers">
          {/* Deliberately NOT the Currents variable row above, which is still
              SOON because uo/vo genuinely are not wired. That row and this one
              make different claims and must not be collapsed into one. */}
          <Layer
            on={showCurrents} swatch="#a98cf0" badge="SYNTHETIC"
            onClick={() => setShowCurrents(!showCurrents)}
            title="A fabricated current field used to prove the time-animation mechanism before spending a real Copernicus fetch. Not GLORYS and not a model."
          >
            Current flow lines
          </Layer>
        </div>
        <p className="hint" style={{ margin: '10px 0 0' }}>
          Invented vectors on a gyre + jet + noise. The scrubber under the 3D
          view steps fabricated frames — the real date and the temperature
          volume are untouched.
        </p>
      </Panel>

      <Panel title="Tools">
        <div className="layers" style={{ marginBottom: 10 }}>
          <Layer on disabled badge="MAP" title="Drag the map to load a new GLORYS tile">
            Select region
          </Layer>
          {TOOLS.map((t) => (
            <Layer key={t} disabled badge="SOON">{t}</Layer>
          ))}
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Hover the 3D view to read a value, click to pin one. The profile and
          the transect both follow the pinned point.
        </p>
      </Panel>
    </>
  )
}
