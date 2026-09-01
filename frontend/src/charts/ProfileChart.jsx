import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import Panel from '../ui/Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { sampleProfile, makeSeafloorAt } from './sampling.js'
import { useColorScale } from '../state/useColorScale.js'
import { useProbe } from '../interaction/useProbe.js'
import { useCurrentsState, useCurrentsData } from '../currents/useCurrentsState.js'
import { sampleCurrentProfile, compass } from './currentsSampling.js'
import SubjectSwitch, { usePanelSubject } from './SubjectSwitch.jsx'

const GRID = '#1e2733'
const AXIS = '#5a6a80'
const TICK = { fill: '#77879e', fontSize: 9.5, fontFamily: 'IBM Plex Mono, monospace' }

// Knots sit on real GLORYS levels, coloured by the SHARED scale — the same
// palette and range the block, the isosurface and the colorbar use, so a knot
// at 20 degC is the colour a 20 degC voxel is. (They used to be normalised
// against this chart's own padded axis instead, which spread them across the
// whole ramp and made a knot's colour mean nothing outside this panel.)
// The dot spacing is itself information: the model resolves the mixed layer
// finely and the deep column coarsely.
function Knot({ cx, cy, payload, colorOf }) {
  if (cx == null || cy == null) return null
  return <circle cx={cx} cy={cy} r={2} fill={colorOf(payload.value)} stroke="#0e131b" strokeWidth={0.6} />
}

const FLOW = '#a98cf0'

// Direction as a rotated tick on the curve, not a second series: speed is m/s
// and heading is degrees, so plotting both against one axis would imply a
// shared scale that does not exist.
function DirTick({ cx, cy, payload }) {
  if (cx == null || cy == null || payload.dir == null) return null
  const a = (payload.dir * Math.PI) / 180      // screen space: +x east, -y north
  const dx = Math.sin(a) * 5, dy = -Math.cos(a) * 5
  return (
    <g>
      <line x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy}
        stroke={FLOW} strokeWidth={1} strokeOpacity={0.75} />
      <circle cx={cx + dx} cy={cy + dy} r={1.4} fill={FLOW} />
    </g>
  )
}

function FlowTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rc-tip">
      <div><span className="k">depth </span>{p.depth.toFixed(1)} m</div>
      <div style={{ color: FLOW }}>{p.speed.toFixed(3)} m/s</div>
      <div><span className="k">toward </span>{p.dir.toFixed(0)}deg {compass(p.dir)}</div>
      <div><span className="k">u/v </span>{p.u.toFixed(3)} / {p.v.toFixed(3)}</div>
    </div>
  )
}

// Speed and direction against depth, from the same uo/vo frame the streamlines
// are traced through.
function FlowProfile({ dataset, rows, lat, lon, from, frameDate, stale }) {
  const deepest = rows.length ? rows[rows.length - 1].depth : 0
  const axisMax = Math.max(60, Math.ceil((deepest * 1.06) / 25) * 25)
  const hi = rows.length ? Math.max(...rows.map((r) => r.speed)) : 1
  return (
    <Panel
      className="chart-profile"
      title="Current profile"
      sub={`${lat.toFixed(2)}°N ${lon.toFixed(2)}°E · ${from}`}
      tools={<SubjectSwitch />}
      bodyClass="chart-body"
      footer={
        <div className="chart-opts cmp-foot">
          <span className="key"><i style={{ background: FLOW }} />speed</span>
          <span>ticks = direction</span>
          <span className="spacer" />
          {/* The timeline can be scrubbed away from the tile's own date. Two
              dates on one screen must never be left to be assumed equal. */}
          <span className={stale ? 'synth' : undefined}>
            {stale
              ? `flow frame ${frameDate} — NOT the ${dataset.meta.date} tile date`
              : `${frameDate} · GLORYS12V1 uo/vo`}
          </span>
        </div>
      }
    >
      {rows.length < 2 ? (
        <div className="empty">
          <b>No column here</b>
          Land, or the seafloor sits above the shallowest model level.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart layout="vertical" data={rows} margin={{ top: 6, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 3" />
            <XAxis
              type="number" dataKey="speed" domain={[0, Math.ceil(hi * 20) / 20]}
              tick={TICK} tickLine={{ stroke: AXIS }} axisLine={{ stroke: AXIS }}
              tickFormatter={(t) => t.toFixed(2)} height={22}
              label={{ value: 'speed (m/s)', position: 'insideBottom', offset: -2, fill: '#5a6a80', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
            />
            <YAxis
              dataKey="depth" type="number" domain={[0, axisMax]} width={42} allowDataOverflow
              tick={TICK} tickLine={{ stroke: AXIS }} axisLine={{ stroke: AXIS }}
              tickFormatter={(t) => t.toFixed(0)}
              label={{ value: 'depth (m)', angle: -90, position: 'insideLeft', offset: 14, fill: '#5a6a80', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
            />
            <Tooltip content={<FlowTip />} cursor={{ stroke: FLOW, strokeWidth: 1, strokeDasharray: '3 3' }} />
            <Line
              type="monotone" dataKey="speed" stroke={FLOW} strokeWidth={1.6}
              isAnimationActive={false} dot={<DirTick />}
              activeDot={{ r: 3, fill: FLOW, stroke: '#0e131b', strokeWidth: 1 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  )
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
  const scale = useColorScale(dataset)
  const selected = useVisualizationState((s) => s.selected)
  const hover = useVisualizationState((s) => s.hover)
  const probe = useProbe(dataset)
  const subject = usePanelSubject()
  const curData = useCurrentsData(dataset)
  const frame = useCurrentsState((s) => s.frame)

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

  const flow = useMemo(() => {
    if (subject !== 'currents' || curData.status !== 'ready') return null
    const f = curData.frames[Math.min(curData.frames.length - 1, frame)]
    return sampleCurrentProfile(f, curData.meta, lat, lon)
  }, [subject, curData, frame, Math.round(lat * 200), Math.round(lon * 200)])

  // After every hook: a conditional return above them would change the hook
  // count between renders.
  if (subject === 'currents') {
    if (curData.status !== 'ready') {
      return (
        <Panel className="chart-profile" title="Current profile"
          sub={curData.status === 'error' ? 'unavailable' : 'loading uo/vo ...'}
          tools={<SubjectSwitch />} bodyClass="chart-body">
          <div className="empty">
            <b>{curData.status === 'error' ? 'Currents unavailable' : 'Loading currents'}</b>
            {curData.status === 'error'
              ? String(curData.error).slice(0, 140)
              : 'Fetching the uo/vo frames for this tile.'}
          </div>
        </Panel>
      )
    }
    const frameDate = curData.meta.dates[Math.min(curData.meta.dates.length - 1, frame)]
    return (
      <FlowProfile
        dataset={dataset} rows={flow ?? []} lat={lat} lon={lon} from={from}
        frameDate={frameDate} stale={frameDate !== dataset.meta.date}
      />
    )
  }

  // Pad and snap in units of the variable's own contour step rather than whole
  // units. Half a step is 1 °C for temperature — exactly the old padding — and
  // 0.25 PSU for salinity, where padding by a whole unit squashed a 2.4-wide
  // column into a third of the axis.
  const q = v.contourStep / 2
  const snapTo = (x, dir) => Number((dir(x / q) * q).toFixed(6))
  const lo = snapTo(Math.min(...data.map((d) => d.value), Infinity) - q, Math.floor)
  const hi = snapTo(Math.max(...data.map((d) => d.value), -Infinity) + q, Math.ceil)

  return (
    <Panel
      className="chart-profile"
      title="Profile"
      sub={`${lat.toFixed(2)}°N ${lon.toFixed(2)}°E · ${from}`}
      tools={<SubjectSwitch />}
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
            {/* Ticks carry minimal decimals rather than a fixed width: whole
                degrees on a 23 °C axis, but a narrow salinity tile lands on
                half-unit ticks that toFixed(0) renders as duplicate labels. */}
            <XAxis
              dataKey="value" type="number" domain={[lo, hi]}
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
              <ReferenceLine y={selected.depthM} stroke="#ffc46b" strokeWidth={1} strokeOpacity={0.35} />
            )}
            {/* the depth cursor's level, labelled — the chart and the 3D marker
                are reading the same index, so this line IS the ring in the scene */}
            {probe && probe.depthM <= axisMax && (
              <ReferenceLine
                y={probe.depthM} stroke="#ffc46b" strokeWidth={1.4}
                label={{
                  value: `L${probe.level} · ${probe.depthM.toFixed(0)} m`,
                  position: 'insideTopRight', fill: '#ffc46b', fontSize: 9,
                  fontFamily: 'IBM Plex Mono, monospace',
                }}
              />
            )}

            <Line
              type="monotone" dataKey="value" stroke="#4fc3f7" strokeWidth={1.6}
              isAnimationActive={false}
              dot={<Knot colorOf={scale.css} />}
              activeDot={{ r: 3.4, fill: '#4fc3f7', stroke: '#0e131b', strokeWidth: 1 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  )
}
