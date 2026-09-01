import { useVisualizationState } from '../state/useVisualizationState.js'
import { IconCheck } from './icons.jsx'
import { useCurrentsState } from '../currents/useCurrentsState.js'
import { useArgoState, useGliderTracks } from '../observations/useObservations.js'
import { usePresets } from './usePresets.js'

// The layer controls, as bodies rather than as panels.
//
// These used to be three <Panel>s in a left rail. The rail is gone and the same
// controls now sit in the in-canvas FIELD and TOOLS panels — so the containers
// changed hands and NOTHING inside them did. Each body keeps its own store
// subscriptions, so a group only re-renders for the state it actually reads.

// Observation networks INCOIS operates in this basin that are NOT yet wired to
// a feed. Argo and gliders have left this list for real data.
const OBSERVATIONS = [
  { key: 'ctd', label: 'CTD stations', color: '#ffc46b' },
  { key: 'drifter', label: 'Drifters', color: '#4fc3f7' },
]

const GLIDER = '#7fd4a8'

// A layer backed by a real third-party service has four outcomes, not two, and
// "none here" is a finding rather than a blank. Saying which one it is, in
// place, is the point: a silently empty layer is indistinguishable from a
// broken one, and neither may be quietly replaced by a mock.
function ObsNote({ state, nounSingular, nounPlural, window: w, children }) {
  if (state.status === 'loading') {
    return <p className="obs-note">Searching {nounPlural}…</p>
  }
  if (state.status === 'error') {
    return (
      <p className="obs-note bad">
        Source unavailable — {String(state.error).slice(0, 110)}
      </p>
    )
  }
  if (state.status === 'empty') {
    return (
      <div className="obs-note empty">
        <b>No {nounSingular} here.</b>{' '}
        {w && (
          <>
            Nothing in this tile between {w.windowFrom} and {w.windowTo} (±{w.windowDays}
            {' '}days of the model date).
          </>
        )}
        {children}
      </div>
    )
  }
  return children ?? null
}

// Region select is the map's drag behaviour and genuinely works, so it is not
// badged SOON — that would be a claim the user can disprove in one click.
const TOOLS = ['Draw transect', 'Measure distance']

// The one row primitive for a toggleable layer. Exported because the
// operational group's stubs are the same control in its disabled state —
// re-implementing that row is how two conventions drift apart.
export function Layer({ on, disabled, children, onClick, swatch, badge, title }) {
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

export function VariablesBody({ dataset }) {
  const variable = useVisualizationState((s) => s.variable)
  const setVariable = useVisualizationState((s) => s.setVariable)
  const vars = dataset.meta.variables

  return (
    <div className="field">
      <span className="lbl">Ocean variables</span>
      <div className="layers">
        {Object.entries(vars).filter(([key]) => key !== 'uo').map(([key, v]) => (
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
  )
}

export function BathymetryBody() {
  const showDetail = useVisualizationState((s) => s.showDetail)
  const setShowDetail = useVisualizationState((s) => s.setShowDetail)

  return (
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
  )
}

export function ObservationsBody({ dataset }) {
  const showArgo = useVisualizationState((s) => s.showArgo)
  const setShowArgo = useVisualizationState((s) => s.setShowArgo)
  const showGliders = useVisualizationState((s) => s.showGliders)
  const setShowGliders = useVisualizationState((s) => s.setShowGliders)
  const selectedGliderId = useVisualizationState((s) => s.selectedGliderId)
  const setSelectedGliderId = useVisualizationState((s) => s.setSelectedGliderId)
  const applyPreset = useVisualizationState((s) => s.applyPreset)
  const argo = useArgoState(dataset)
  const gliders = useGliderTracks(dataset)
  const presets = usePresets()

  return (
    <div className="field">
      <span className="lbl">Observations</span>
      <div className="layers">
        {/* Real Argo now, through the same ObservationSource seam the mock
            used. Badged REAL, and the float's WMO, DAC and data mode are
            carried into the comparison panel — provenance IS the claim. */}
        <Layer
          on={showArgo} swatch="#84a9c0" badge="REAL"
          onClick={() => setShowArgo(!showArgo)}
          title="Real Argo floats from the Argo GDAC (Ifremer ERDDAP) — click one in the 3D view to compare its measured profile against the model"
        >
          Argo floats
        </Layer>
        <Layer
          on={showGliders} swatch={GLIDER} badge="REAL"
          onClick={() => setShowGliders(!showGliders)}
          title="Real glider tracks from the OceanGliders GDAC, drawn as a path through the volume rather than a marker"
        >
          Gliders
        </Layer>
        {OBSERVATIONS.map((o) => (
          <Layer key={o.key} disabled swatch={o.color} badge="SOON"
            title={`${o.label} — no feed connected yet`}>
            {o.label}
          </Layer>
        ))}
      </div>

      {showArgo && (
        <ObsNote state={argo} nounSingular="Argo float" nounPlural="Argo floats"
          window={argo.meta}>
          {argo.status === 'ready' && argo.meta && (
            <p className="obs-note">
              {argo.floats.length} float{argo.floats.length === 1 ? '' : 's'} profiled
              {' '}{argo.meta.windowFrom} to {argo.meta.windowTo} — ±{argo.meta.windowDays} days
              of the model date, because an Argo cycle is ~10 days and none
              profiles daily. Click one in the 3D view.
            </p>
          )}
        </ObsNote>
      )}

      {showGliders && (
        <ObsNote state={gliders} nounSingular="glider deployment"
          nounPlural="glider deployments" window={gliders.meta}>
          {gliders.status === 'ready' && (
            <div className="obs-picker">
              <p className="obs-note">
                {gliders.tracks.length} deployment{gliders.tracks.length === 1 ? '' : 's'} in
                this tile — pick one to draw its track:
              </p>
              {gliders.tracks.map((t) => (
                <button
                  key={t.id} type="button"
                  className={`layer${selectedGliderId === t.id ? ' on' : ''}`}
                  aria-pressed={selectedGliderId === t.id}
                  onClick={() => setSelectedGliderId(selectedGliderId === t.id ? null : t.id)}
                  title={`${t.deployment} · ${t.dateFrom} to ${t.dateTo}`}
                >
                  <span className="tick"><IconCheck size={9} /></span>
                  <span className="name">{t.deployment}</span>
                  <span className="badge">{t.dateFrom}</span>
                </button>
              ))}
            </div>
          )}
        </ObsNote>
      )}

      {/* Where the data IS, when it is not here. Labelled as a jump to real
          historical data, never dressed up as the current tile. */}
      {showGliders && gliders.status === 'empty'
        && presets.filter((p) => p.kind !== 'scenario').map((p) => (
        <button key={p.id} type="button" className="preset" onClick={() => applyPreset(p)}>
          <span className="preset-go">Go to real data</span>
          <span className="preset-label">{p.label}</span>
          <span className="preset-sub">{p.sub} · {p.date}</span>
          <span className="preset-why">{p.why}</span>
        </button>
      ))}
    </div>
  )
}

export function CirculationBody() {
  const showCurrents = useCurrentsState((s) => s.showCurrents)
  const setShowCurrents = useCurrentsState((s) => s.setShowCurrents)
  const setPanelLayer = useVisualizationState((s) => s.setPanelLayer)

  return (
    <div className="field">
      <span className="lbl">Circulation</span>
      <div className="layers">
        {/* uo/vo are a VECTOR pair, so they are not in the scalar variable
            list above — a colour-ramped velocity volume is a different (and
            worse) way to show circulation than streamlines. */}
        <Layer
          on={showCurrents} swatch="#a98cf0" badge="REAL"
          onClick={() => { const n = !showCurrents; setShowCurrents(n); setPanelLayer(n ? 'currents' : 'field') }}
          title="Measured GLORYS12V1 uo/vo, traced as streamlines. Step or play the dates under the 3D view."
        >
          Current flow lines
        </Layer>
      </div>
      <p className="hint" style={{ margin: '9px 0 0' }}>
        Streamlines through the measured velocity field, one frame per GLORYS
        day. Lines stop at the coast rather than crossing it — the field is
        masked there, not filled.
      </p>
    </div>
  )
}

export function ToolsBody() {
  return (
    <>
      <div className="layers" style={{ marginBottom: 10 }}>
        <Layer on disabled badge="MAP" title="Always on — drag a box on the map in the top right of the 3D view to load that tile">
          Select region
        </Layer>
        {TOOLS.map((t) => (
          <Layer key={t} disabled badge="SOON">{t}</Layer>
        ))}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Drag a box on the map in the top right of the view to load a different
        tile, 1.5–10° per side. Hover the 3D view to read a value, click to pin
        one — the profile and the transect both follow the pinned point.
      </p>
    </>
  )
}
