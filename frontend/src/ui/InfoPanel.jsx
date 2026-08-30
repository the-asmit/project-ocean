import { useEffect, useState } from 'react'
import Panel, { IconButton } from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { useProbe } from '../interaction/useProbe.js'
import { IconTarget, IconCollapse } from './icons.jsx'

// The depth cursor. The pin fixes a lon/lat; this travels down that column and
// reads the interior at each real model level, which is the whole point of
// holding a volume rather than a stack of surfaces — no re-pick, no re-fetch,
// just the column under one point.
function DepthCursor({ dataset, probe }) {
  const setProbeIndex = useVisualizationState((s) => s.setProbeIndex)
  const units = dataset.meta.volume.units

  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      const next = probe.index + (e.code === 'ArrowDown' ? 1 : -1)
      setProbeIndex(Math.min(probe.levelCount - 1, Math.max(0, next)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [probe.index, probe.levelCount, setProbeIndex])

  const dead = probe.value == null
  return (
    <div className="probe">
      <div className="srow">
        <label className="lbl" htmlFor="sl-depth-cursor">Depth cursor</label>
        <span className="num">L{probe.level} · {probe.depthM.toFixed(1)} m</span>
      </div>
      <input
        id="sl-depth-cursor" type="range"
        min={0} max={probe.levelCount - 1} step={1} value={probe.index}
        onChange={(e) => setProbeIndex(parseInt(e.target.value, 10))}
      />
      <div className={`probe-read${dead ? ' dead' : ''}`}>
        {dead ? (
          <span className="why">
            {probe.belowSeafloor
              ? 'below the seafloor here'
              : `no value — past the ${dataset.meta.volume.maxDepthM.toFixed(0)} m extent`}
          </span>
        ) : (
          <>
            <span className="big">{probe.value.toFixed(2)}</span>
            <span className="unit">{units}</span>
          </>
        )}
      </div>
      <div className="hint">
        Level {probe.level} of {probe.levelCount} · ↑ ↓ steps one level.
        {probe.seafloorM != null && ` Seafloor ${probe.seafloorM.toFixed(0)} m.`}
      </div>
    </div>
  )
}

// Docked detail for the pinned point (was a slide-in overlay; in a dashboard it
// belongs in the rail). The headline value comes from the same volume the shader
// renders. It additionally issues a /point query against the source NetCDF so
// the panel can show the authoritative server-side value and the exact GLORYS
// grid cell it came from — useful for spotting client/server drift rather than
// hiding it.
export default function InfoPanel({ dataset }) {
  const selected = useVisualizationState((s) => s.selected)
  const clearSelected = useVisualizationState((s) => s.clearSelected)
  const variable = useVisualizationState((s) => s.variable)
  const probe = useProbe(dataset)
  const [server, setServer] = useState(null)

  useEffect(() => {
    if (!selected) { setServer(null); return }
    let cancelled = false
    const { lat, lon, sampleDepthM, depthM } = selected
    const q = new URLSearchParams({
      lat: lat.toFixed(5), lon: lon.toFixed(5),
      depth: (sampleDepthM ?? depthM).toFixed(2),
      region: dataset.meta.region, date: dataset.meta.date, variable,
    })
    setServer({ loading: true })
    fetch(`/api/point?${q}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setServer(j))
      .catch((e) => !cancelled && setServer({ error: String(e) }))
    return () => { cancelled = true }
  }, [selected, dataset, variable])

  const m = dataset.meta

  if (!selected) {
    return (
      <Panel title="Pinned point">
        <div className="empty">
          <IconTarget size={22} />
          <b>Nothing pinned</b>
          Click anywhere in the 3D view to pin a point. The profile and
          transect follow it.
        </div>
      </Panel>
    )
  }

  return (
    <Panel
      title="Pinned point"
      sub={m.volume.variableLabel}
      tools={<IconButton label="Clear pin (Esc)" onClick={clearSelected}><IconCollapse size={13} /></IconButton>}
    >
      <div className="pin-in">
        <div className="pin-head">
          <span className="dot" />
          <span className="lbl">{selected.kind === 'seafloor' ? 'On the seafloor' : 'In the water column'}</span>
        </div>

        <div className="readout">
          {selected.value == null ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 11.5, lineHeight: 1.55 }}>
              No data here — land, or below the seafloor.
            </div>
          ) : (
            <>
              <span className="big">{selected.value.toFixed(2)}</span>
              <span className="unit">{m.volume.units}</span>
              <div className="where">
                {selected.lat.toFixed(3)}°N&ensp;{selected.lon.toFixed(3)}°E&ensp;·&ensp;{selected.depthM.toFixed(0)} m
              </div>
            </>
          )}
        </div>

        {probe && <DepthCursor dataset={dataset} probe={probe} />}

        {selected.clamped && (
          <div className="hint" style={{ color: 'var(--pin)', marginTop: 9 }}>
            Seafloor is {selected.depthM.toFixed(0)} m — deeper than the
            {' '}{m.volume.maxDepthM.toFixed(0)} m the field reaches. Sampled at
            {' '}{selected.sampleDepthM.toFixed(0)} m, the deepest level with data.
          </div>
        )}

        <div className="rule" />

        <div className="lbl" style={{ display: 'block', marginBottom: 7 }}>Server verification</div>
        <div className="kv">
          {!server || server.loading ? (
            <><span className="k">status</span><span className="v">querying…</span></>
          ) : server.error ? (
            <><span className="k">error</span><span className="v warn">{server.error}</span></>
          ) : (
            <>
              <span className="k">value</span>
              <span className="v">
                {server.value == null ? `— (${server.reason})` : `${server.value.toFixed(3)} ${server.units}`}
              </span>
              <span className="k">grid cell</span>
              <span className="v">
                {server.gridLat != null ? `${server.gridLat.toFixed(3)}°, ${server.gridLon.toFixed(3)}°` : '—'}
              </span>
              <span className="k">level</span>
              <span className="v">
                {server.nearestLevelM != null ? `${server.nearestLevelM.toFixed(1)} m` : '—'}
              </span>
            </>
          )}
        </div>

        <div className="rule" />

        <div className="kv">
          <span className="k">dataset</span><span className="v">{m.volume.datasetId}</span>
          <span className="k">date</span><span className="v">{m.date}</span>
          <span className="k">grid</span><span className="v">1/12° (~9 km)</span>
          <span className="k">region</span><span className="v">{m.regionLabel}</span>
        </div>
      </div>
    </Panel>
  )
}
