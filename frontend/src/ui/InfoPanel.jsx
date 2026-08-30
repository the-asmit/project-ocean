import { useEffect, useState } from 'react'
import { useVisualizationState } from '../state/useVisualizationState.js'

// Slide-in detail panel for the pinned point. The headline value comes from the
// same volume the shader renders (client-side sampler). It additionally issues a
// /point query against the source NetCDF so the panel can show the authoritative
// server-side value and the exact GLORYS grid cell it came from — useful for
// spotting any client/server drift rather than hiding it.
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
  const open = !!selected

  return (
    <div className={`card overlay infopanel${open ? ' open' : ''}`}>
      <button className="close" onClick={clearSelected} aria-label="Close">×</button>
      {selected && (
        <>
          <div>
            <div className="h-label">Selected point</div>
            <h2 style={{ marginTop: 4 }}>{m.volume.variableLabel}</h2>
          </div>

          <div className="readout">
            {selected.value == null ? (
              <div style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
                No data here — land or below the seafloor.
              </div>
            ) : (
              <>
                <span className="big">{selected.value.toFixed(2)}</span>
                <span className="unit">{m.volume.units}</span>
              </>
            )}
          </div>

          <div className="rule" />

          <div className="kv">
            <span className="k">Latitude</span><span className="v">{selected.lat.toFixed(4)}°</span>
            <span className="k">Longitude</span><span className="v">{selected.lon.toFixed(4)}°</span>
            <span className="k">{selected.kind === 'seafloor' ? 'Seafloor' : 'Depth'}</span>
            <span className="v">{selected.depthM.toFixed(1)} m</span>
            {selected.clamped && (
              <>
                <span className="k">Sampled at</span>
                <span className="v" style={{ color: 'var(--warn)' }}>
                  {selected.sampleDepthM.toFixed(0)} m — deepest level with data
                </span>
              </>
            )}
            <span className="k">Surface</span><span className="v">{selected.kind}</span>
          </div>

          <div className="rule" />

          <div>
            <div className="h-label" style={{ marginBottom: 6 }}>Server verification</div>
            <div className="kv">
              {!server || server.loading ? (
                <><span className="k">status</span><span className="v">querying…</span></>
              ) : server.error ? (
                <><span className="k">error</span><span className="v">{server.error}</span></>
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
          </div>

          <div className="rule" />

          <div className="kv">
            <span className="k">Source</span><span className="v">{m.volume.source}</span>
            <span className="k">Dataset</span><span className="v" style={{ fontSize: 10 }}>{m.volume.datasetId}</span>
            <span className="k">Date</span><span className="v">{m.date}</span>
            <span className="k">Resolution</span><span className="v">1/12° (~9 km)</span>
            <span className="k">Region</span><span className="v">{m.regionLabel}</span>
          </div>
        </>
      )}
    </div>
  )
}
