import { useMemo, useState } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import Panel from '../ui/Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { sampleTransect, isothermDepths, isothermValues, rampColor } from './sampling.js'
import { sampleCurrentTransect, compass } from './currentsSampling.js'
import { useCurrentsState, useCurrentsData } from '../currents/useCurrentsState.js'
import SubjectSwitch, { usePanelSubject } from './SubjectSwitch.jsx'
import { contourName, fmtStep } from '../ui/variableTerms.js'

const GRID = '#1e2733'
const AXIS = '#5a6a80'
const TICK = { fill: '#77879e', fontSize: 9.5, fontFamily: 'IBM Plex Mono, monospace' }

function TransectTip({ active, payload, label, units }) {
  if (!active || !payload?.length) return null
  const floor = payload.find((p) => p.dataKey === 'seafloor')
  const isos = payload.filter((p) => p.dataKey !== 'seafloor' && p.value != null)
  return (
    <div className="rc-tip">
      <div><span className="k">dist </span>{Number(label).toFixed(0)} km</div>
      {floor?.value != null && (
        <div><span className="k">seafloor </span>{floor.value.toFixed(0)} m</div>
      )}
      {isos.slice(0, 4).map((p) => (
        <div key={p.dataKey} style={{ color: p.stroke }}>
          {p.name} {units} <span className="k">at</span> {p.value.toFixed(0)} m
        </div>
      ))}
    </div>
  )
}

const FLOW = '#a98cf0'

// Recharts treats a string dataKey as an object path, so a decimal point in the
// key (a 33.25 PSU isohaline) would be read as nesting and resolve to nothing.
const isoKey = (v) => `t${String(v).replace(/[.-]/g, '_')}`

function FlowTransectTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  if (p.speed == null) {
    return <div className="rc-tip"><div><span className="k">no data </span>land or seafloor</div></div>
  }
  return (
    <div className="rc-tip">
      <div><span className="k">at </span>{p.km.toFixed(0)} km · {p.lon.toFixed(2)}°E</div>
      <div style={{ color: FLOW }}>{p.speed.toFixed(3)} m/s</div>
      <div><span className="k">toward </span>{p.dir.toFixed(0)}deg {compass(p.dir)}</div>
    </div>
  )
}

// Speed along the same W->E line the isotherm section uses, at the depth level
// the currents layer itself is set to. Iso-speed contours would mirror the
// isotherm rendering, but speed does not stratify the way temperature does and
// a contour set of it reads as noise.
function FlowTransect({ dataset, rows, lengthKm, lat, from, depthM, frameDate, stale }) {
  const hi = Math.max(0.05, ...rows.map((r) => r.speed ?? 0))
  return (
    <Panel
      className="chart-transect"
      title="Current transect"
      sub={`W→E at ${lat.toFixed(2)}°N · ${lengthKm.toFixed(0)} km · ${depthM.toFixed(depthM < 10 ? 1 : 0)} m · from ${from}`}
      tools={<SubjectSwitch />}
      bodyClass="chart-body"
      footer={
        <div className="chart-opts">
          <span className="key"><i style={{ background: FLOW }} />speed at {depthM.toFixed(depthM < 10 ? 1 : 0)} m</span>
          <span>gaps are land or below the seafloor</span>
          <span className="spacer" />
          <span className={stale ? 'synth' : undefined}>
            {stale
              ? `flow frame ${frameDate} — NOT the ${dataset.meta.date} tile date`
              : `${frameDate} · GLORYS12V1 uo/vo`}
          </span>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 14, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 3" />
          <XAxis
            dataKey="km" type="number" domain={[0, 'dataMax']}
            tick={TICK} tickLine={{ stroke: AXIS }} axisLine={{ stroke: AXIS }}
            tickFormatter={(t) => t.toFixed(0)} height={22}
            label={{ value: 'distance (km)', position: 'insideBottom', offset: -2, fill: '#5a6a80', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <YAxis
            type="number" domain={[0, Math.ceil(hi * 20) / 20]} width={42} allowDataOverflow
            tick={TICK} tickLine={{ stroke: AXIS }} axisLine={{ stroke: AXIS }}
            tickFormatter={(t) => t.toFixed(2)}
            label={{ value: 'speed (m/s)', angle: -90, position: 'insideLeft', offset: 14, fill: '#5a6a80', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <Tooltip content={<FlowTransectTip />} cursor={{ stroke: FLOW, strokeWidth: 1, strokeDasharray: '3 3' }} />
          <Line
            type="monotone" dataKey="speed" stroke={FLOW} strokeWidth={1.6}
            dot={false} isAnimationActive={false} connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export default function TransectChart({ dataset }) {
  const selected = useVisualizationState((s) => s.selected)
  const hover = useVisualizationState((s) => s.hover)
  const [showIso, setShowIso] = useState(true)
  const [showBathy, setShowBathy] = useState(true)
  // A MULTIPLE of the variable's own contour interval, not an absolute
  // value: 1/2/4 °C is meaningless on a 3.8 PSU field, and holding a
  // multiplier means switching variable needs no reset.
  const [mult, setMult] = useState(1)
  const [range, setRange] = useState('data')
  const subject = usePanelSubject()
  const curData = useCurrentsData(dataset)
  const frame = useCurrentsState((s) => s.frame)
  const levelIndex = useCurrentsState((s) => s.levelIndex)

  const v = dataset.meta.volume
  const interval = v.contourStep * mult
  const b = dataset.meta.bathymetry

  // The section follows the pinned point, then the cursor, then the tile centre.
  const lat = selected?.lat ?? hover?.lat ?? (b.latMin + b.latMax) / 2
  const from = selected ? 'pinned point' : hover ? 'cursor' : 'tile centre'

  const section = useMemo(
    () => sampleTransect(dataset, Math.round(lat * 24) / 24),   // snap to ~½ cell
    [dataset, Math.round(lat * 24)],   // eslint-disable-line react-hooks/exhaustive-deps
  )

  const isos = useMemo(
    () => (showIso ? isothermValues(section, interval) : []),
    [section, interval, showIso],
  )

  const data = useMemo(() => {
    const cols = isos.map((val) => ({ val, depths: isothermDepths(section, val) }))
    return section.rows.map((r, i) => {
      const row = { km: r.km, seafloor: r.land ? null : r.seafloor }
      for (const c of cols) row[isoKey(c.val)] = c.depths[i]
      return row
    })
  }, [section, isos])

  const flow = useMemo(() => {
    if (subject !== 'currents' || curData.status !== 'ready') return null
    const f = curData.frames[Math.min(curData.frames.length - 1, frame)]
    const lvl = Math.min(curData.meta.levels - 1, levelIndex)
    return sampleCurrentTransect(f, curData.meta, Math.round(lat * 24) / 24, lvl)
  }, [subject, curData, frame, levelIndex, Math.round(lat * 24)])

  const maxDepth = range === 'data' ? Math.ceil(v.maxDepthM / 50) * 50 : b.bathyMaxM

  // after every hook
  if (subject === 'currents' && flow) {
    const frameDate = curData.meta.dates[Math.min(curData.meta.dates.length - 1, frame)]
    return (
      <FlowTransect
        dataset={dataset} rows={flow.rows} lengthKm={flow.lengthKm}
        lat={lat} from={from} depthM={flow.depthM}
        frameDate={frameDate} stale={frameDate !== dataset.meta.date}
      />
    )
  }

  return (
    <Panel
      className="chart-transect"
      title="Transect"
      sub={`W→E section at ${lat.toFixed(2)}°N · ${section.lengthKm.toFixed(0)} km · from ${from}`}
      tools={<SubjectSwitch />}
      bodyClass="chart-body"
      footer={
        <div className="chart-opts">
          <label>
            <input type="checkbox" checked={showIso} onChange={(e) => setShowIso(e.target.checked)} />
            {contourName(v.variable, true)}
          </label>
          <label>
            <input type="checkbox" checked={showBathy} onChange={(e) => setShowBathy(e.target.checked)} />
            Bathymetry
          </label>
          <label>
            Interval
            <select value={mult} onChange={(e) => setMult(+e.target.value)}>
              {[0.5, 1, 2].map((m) => (
                <option key={m} value={m}>{fmtStep(v.contourStep * m)} {v.units}</option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          <label>
            Depth
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="data">0–{Math.ceil(v.maxDepthM / 50) * 50} m (data)</option>
              <option value="full">0–{b.bathyMaxM.toFixed(0)} m (seafloor)</option>
            </select>
          </label>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 14, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 3" />
          <XAxis
            dataKey="km" type="number" domain={[0, 'dataMax']}
            tick={TICK} tickLine={{ stroke: AXIS }} axisLine={{ stroke: AXIS }}
            tickFormatter={(t) => t.toFixed(0)} height={22}
            label={{ value: 'distance (km)', position: 'insideBottom', offset: -2, fill: '#5a6a80', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <YAxis
            type="number" domain={[0, maxDepth]} reversed width={42} allowDataOverflow
            tick={TICK} tickLine={{ stroke: AXIS }} axisLine={{ stroke: AXIS }}
            tickFormatter={(t) => t.toFixed(0)}
            label={{ value: 'depth (m)', angle: -90, position: 'insideLeft', offset: 14, fill: '#5a6a80', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <Tooltip
            content={<TransectTip units={v.units} />}
            cursor={{ stroke: '#4fc3f7', strokeWidth: 1, strokeDasharray: '3 3' }}
          />

          {showBathy && (
            <Area
              type="monotone" dataKey="seafloor" baseValue={maxDepth}
              stroke="#7c8ea6" strokeWidth={1.1} fill="#2b3542" fillOpacity={0.9}
              connectNulls={false} isAnimationActive={false} dot={false} name="seafloor"
            />
          )}

          {isos.map((val) => (
            <Line
              key={val} type="monotone" dataKey={isoKey(val)} name={String(val)}
              stroke={rampColor((val - v.valueMin) / (v.valueMax - v.valueMin))}
              strokeWidth={1.4} dot={false} connectNulls={false} isAnimationActive={false}
            />
          ))}

          {v.maxDepthM < maxDepth && (
            <ReferenceLine
              y={v.maxDepthM} stroke="#ffc46b" strokeDasharray="4 3" strokeOpacity={0.75}
              label={{ value: `no ${v.variableLabel.toLowerCase()} data below ${v.maxDepthM.toFixed(0)} m`, position: 'insideTopRight', fill: '#ffc46b', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}
