import { useEffect, useState } from 'react'
import Panel, { IconButton } from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { IconTarget, IconCollapse } from './icons.jsx'

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
