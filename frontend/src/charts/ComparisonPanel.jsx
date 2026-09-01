import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import Panel, { IconButton } from '../ui/Panel.jsx'
import { IconCollapse, IconTarget } from '../ui/icons.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { useComparison } from '../observations/useObservations.js'

// Model vs float — the PS's headline gap, as its own permanent panel.
//
// It used to REPLACE the Profile panel whenever a float was selected, which
// meant the two things a forecaster wants to see together could never be on
// screen at the same time: the model column, and how it compares to what was
// measured. It is a third panel now, and the Profile panel stays on the model.
//
// With no float selected this is an empty state rather than a hidden panel —
// the comparison is the point of the tool, so its absence is worth a sentence.

const GRID = '#1e2733'
const AXIS = '#5a6a80'
const TICK = { fill: '#77879e', fontSize: 9.5, fontFamily: 'IBM Plex Mono, monospace' }

// Float curve is ink white, matching the selected marker in the 3D scene.
// Green sat outside the console palette and clashed with the cyan model curve.
const OBS = '#e4ecf7'

function CmpTip({ active, payload, units }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rc-tip">
      <div><span className="k">depth </span>{p.depth.toFixed(0)} m</div>
      <div style={{ color: OBS }}>float {p.obs?.toFixed(2)} {units}</div>
      <div style={{ color: '#4fc3f7' }}>model {p.model?.toFixed(2) ?? '—'} {units}</div>
      {p.diff != null && (
        <div><span className="k">Δ </span>{p.diff > 0 ? '+' : ''}{p.diff.toFixed(2)} {units}</div>
      )}
    </div>
  )
}

// Observation against model at the same position and day. Two curves, one axis.
function ComparisonChart({ dataset, cmp }) {
  const clearSelected = useVisualizationState((s) => s.clearSelected)
  const v = dataset.meta.volume
  const { float, rows, meanAbsDiff, worst } = cmp

  const deepest = rows.length ? rows[rows.length - 1].depth : 0
  const axisMax = Math.max(60, Math.ceil((deepest * 1.06) / 25) * 25)
  const vals = rows.flatMap((r) => [r.obs, r.model]).filter((x) => x != null)
  // padded and snapped in units of the variable's own contour step — 1 °C for
  // temperature, exactly as before, and 0.25 PSU for salinity
  const qc = v.contourStep / 2
  const lo = Number((Math.floor((Math.min(...vals) - qc) / qc) * qc).toFixed(6))
  const hi = Number((Math.ceil((Math.max(...vals) + qc) / qc) * qc).toFixed(6))

  return (
    /* chart-compare, not chart-profile: this panel used to REPLACE the profile
       and inherited its grid column along with the class. As its own column it
       would otherwise render on top of the profile. */
    <Panel
      className="chart-compare"
      title="Model vs float"
      sub={`${float.label} · ${float.lat.toFixed(2)}°N ${float.lon.toFixed(2)}°E · ${float.date}`}
      tools={
        <IconButton label="Back to profile (Esc)" onClick={clearSelected}>
          <IconCollapse size={13} />
        </IconButton>
      }
      bodyClass="chart-body"
      footer={
        <div className="chart-opts cmp-foot">
          <span className="key"><i style={{ background: OBS }} />float</span>
          <span className="key"><i style={{ background: '#4fc3f7' }} />model</span>
          <span className="spacer" />
          {meanAbsDiff != null && (
            <span>mean |Δ| {meanAbsDiff.toFixed(2)} {v.units}</span>
          )}
          {worst && (
            <span>max {worst.diff > 0 ? '+' : ''}{worst.diff.toFixed(2)} at {worst.depthM.toFixed(0)} m</span>
          )}
          {/* P3: the profile beside the model curve is a real measurement now,
              so the claim to make is PROVENANCE — which float, whose DAC, and
              whether it has been through delayed-mode QC or only the automatic
              real-time checks. A fabricated one would still say so instead. */}
          {cmp.synthetic ? (
            <span className="synth">SYNTHETIC float — not a measurement</span>
          ) : (
            <span>
              {float.dacLabel} · cycle {float.cycle} ·{' '}
              {float.dataMode === 'D' ? 'delayed-mode (adjusted)' : 'real-time (automatic QC)'}
            </span>
          )}
          {/* The float did not profile on the model's date — Argo cycles about
              every 10 days. Two dates on one chart are never left to be
              assumed equal, the same rule the currents timeline follows. */}
          {!cmp.synthetic && float.date !== dataset.meta.date && (
            <span className="synth">
              float profiled {float.date} — NOT the {dataset.meta.date} model date
            </span>
          )}
        </div>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart layout="vertical" data={rows} margin={{ top: 6, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 3" />
          <XAxis
            type="number" domain={[lo, hi]}
            tick={TICK} tickLine={{ stroke: AXIS }} axisLine={{ stroke: AXIS }}
            tickFormatter={(t) => Number(t.toFixed(2)).toString()} height={22}
            label={{ value: `${v.variableLabel.toLowerCase()} (${v.units})`, position: 'insideBottom', offset: -2, fill: '#5a6a80', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <YAxis
            dataKey="depth" type="number" domain={[0, axisMax]} width={42} allowDataOverflow
            tick={TICK} tickLine={{ stroke: AXIS }} axisLine={{ stroke: AXIS }}
            tickFormatter={(t) => t.toFixed(0)}
            label={{ value: 'depth (m)', angle: -90, position: 'insideLeft', offset: 14, fill: '#5a6a80', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <Tooltip content={<CmpTip units={v.units} />} cursor={{ stroke: '#4fc3f7', strokeWidth: 1, strokeDasharray: '3 3' }} />
          <Line
            type="monotone" dataKey="model" stroke="#4fc3f7" strokeWidth={1.6}
            dot={false} isAnimationActive={false} connectNulls={false}
          />
          <Line
            type="monotone" dataKey="obs" stroke={OBS} strokeWidth={1.6}
            strokeDasharray="4 2" dot={{ r: 1.5, fill: OBS, strokeWidth: 0 }}
            isAnimationActive={false} connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export default function ComparisonPanel({ dataset }) {
  const cmp = useComparison(dataset)
  const showArgo = useVisualizationState((s) => s.showArgo)

  if (cmp) return <ComparisonChart dataset={dataset} cmp={cmp} />

  return (
    <Panel className="chart-compare" title="Model vs float" bodyClass="chart-body">
      <div className="empty">
        <IconTarget size={20} />
        <b>No float selected</b>
        {showArgo
          ? 'Click an Argo float in the 3D view — the small sphere at the waterline with a stem below it — to plot its measured profile against the model column at the same position.'
          : 'Turn on the Argo layer in FIELD, then click a float in the 3D view to compare its measured profile against the model.'}
      </div>
    </Panel>
  )
}
