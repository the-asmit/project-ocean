import { useMemo, useState } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import Panel from '../ui/Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { sampleTransect, isothermDepths, isothermValues, rampColor } from './sampling.js'

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

export default function TransectChart({ dataset }) {
  const selected = useVisualizationState((s) => s.selected)
  const hover = useVisualizationState((s) => s.hover)
  const [showIso, setShowIso] = useState(true)
  const [showBathy, setShowBathy] = useState(true)
  const [interval, setInterval] = useState(2)
  const [range, setRange] = useState('data')

  const v = dataset.meta.volume
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
      for (const c of cols) row[`t${c.val}`] = c.depths[i]
      return row
    })
  }, [section, isos])

  const maxDepth = range === 'data' ? Math.ceil(v.maxDepthM / 50) * 50 : b.bathyMaxM

  return (
    <Panel
      className="chart-transect"
      title="Transect"
      sub={`W→E section at ${lat.toFixed(2)}°N · ${section.lengthKm.toFixed(0)} km · from ${from}`}
      bodyClass="chart-body"
      footer={
        <div className="chart-opts">
          <label>
            <input type="checkbox" checked={showIso} onChange={(e) => setShowIso(e.target.checked)} />
            Isotherms
          </label>
          <label>
            <input type="checkbox" checked={showBathy} onChange={(e) => setShowBathy(e.target.checked)} />
            Bathymetry
          </label>
          <label>
            Interval
            <select value={interval} onChange={(e) => setInterval(+e.target.value)}>
              {[1, 2, 4].map((n) => <option key={n} value={n}>{n} {v.units}</option>)}
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
              key={val} type="monotone" dataKey={`t${val}`} name={String(val)}
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
