import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import Panel from '../ui/Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { sampleProfile, makeSeafloorAt, rampColor } from './sampling.js'

const GRID = '#1e2733'
const AXIS = '#5a6a80'
const TICK = { fill: '#77879e', fontSize: 9.5, fontFamily: 'IBM Plex Mono, monospace' }

// Knots sit on real GLORYS levels, coloured by the same ramp as the volume —
// the dot spacing is itself information: the model resolves the mixed layer
// finely and the deep column coarsely.
function Knot({ cx, cy, payload, lo, hi }) {
  if (cx == null || cy == null) return null
  return <circle cx={cx} cy={cy} r={2} fill={rampColor((payload.value - lo) / (hi - lo))} stroke="#0e131b" strokeWidth={0.6} />
}

function ProfileTip({ active, payload, units }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rc-tip">
      <div><span className="k">depth </span>{p.depth.toFixed(1)} m</div>
      <div><span className="k">value </span>{p.value.toFixed(2)} {units}</div>
    </div>
  )
}

export default function ProfileChart({ dataset }) {
  const selected = useVisualizationState((s) => s.selected)
  const hover = useVisualizationState((s) => s.hover)

  const v = dataset.meta.volume
  const b = dataset.meta.bathymetry
  const pt = selected ?? hover
  const lat = pt?.lat ?? (b.latMin + b.latMax) / 2
  const lon = pt?.lon ?? (b.lonMin + b.lonMax) / 2
  const from = selected ? 'pinned point' : hover ? 'cursor' : 'tile centre'

  const data = useMemo(
    () => sampleProfile(dataset, lat, lon),
    [dataset, Math.round(lat * 200), Math.round(lon * 200)],
  )

  const seafloor = useMemo(() => {
    const f = makeSeafloorAt(dataset)
    return f(dataset.map.lonToX(lon), dataset.map.latToZ(lat))
  }, [dataset, Math.round(lat * 200), Math.round(lon * 200)])

  const deepest = data.length ? data[data.length - 1].depth : 0
  const axisMax = Math.max(60, Math.ceil((deepest * 1.06) / 25) * 25)

  const lo = Math.floor(Math.min(...data.map((d) => d.value), Infinity) - 1)
  const hi = Math.ceil(Math.max(...data.map((d) => d.value), -Infinity) + 1)

  return (
    <Panel
      className="chart-profile"
      title="Profile"
      sub={`${lat.toFixed(2)}°N ${lon.toFixed(2)}°E · ${from}`}
      bodyClass="chart-body"
    >
      {data.length < 2 ? (
        <div className="empty">
          <b>No column here</b>
          Land, or the seafloor sits above the shallowest model level.
          Hover the water in the 3D view to read a profile.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart layout="vertical" data={data} margin={{ top: 6, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 3" />
            <XAxis
              dataKey="value" type="number" domain={[lo, hi]}
              tick={TICK} tickLine={{ stroke: AXIS }} axisLine={{ stroke: AXIS }}
              tickFormatter={(t) => t.toFixed(0)} height={22}
              label={{ value: `${v.variableLabel.toLowerCase()} (${v.units})`, position: 'insideBottom', offset: -2, fill: '#5a6a80', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
            />
            <YAxis
              dataKey="depth" type="number" domain={[0, axisMax]} width={42} allowDataOverflow
              tick={TICK} tickLine={{ stroke: AXIS }} axisLine={{ stroke: AXIS }}
              tickFormatter={(t) => t.toFixed(0)}
              label={{ value: 'depth (m)', angle: -90, position: 'insideLeft', offset: 14, fill: '#5a6a80', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
            />
            <Tooltip
              content={<ProfileTip units={v.units} />}
              cursor={{ stroke: '#4fc3f7', strokeWidth: 1, strokeDasharray: '3 3' }}
            />

            {Number.isFinite(seafloor) && seafloor <= axisMax && (
              <ReferenceLine
                y={seafloor} stroke="#7c8ea6" strokeDasharray="3 3"
                label={{ value: `seafloor ${seafloor.toFixed(0)} m`, position: 'insideBottomRight', fill: '#7c8ea6', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
              />
            )}
            {selected?.depthM != null && selected.depthM <= axisMax && (
              <ReferenceLine y={selected.depthM} stroke="#ffc46b" strokeWidth={1} strokeOpacity={0.8} />
            )}

            <Line
              type="monotone" dataKey="value" stroke="#4fc3f7" strokeWidth={1.6}
              isAnimationActive={false}
              dot={<Knot lo={lo} hi={hi} />}
              activeDot={{ r: 3.4, fill: '#4fc3f7', stroke: '#0e131b', strokeWidth: 1 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  )
}
