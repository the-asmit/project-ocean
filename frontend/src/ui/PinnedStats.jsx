import { useEffect, useState } from 'react'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { useProbe } from '../interaction/useProbe.js'

// The read-only half of the pinned point, outside the canvas.
//
// The interactive half — the depth cursor — is in the 3D view, next to the
// marker it drives. What is left is numbers you read rather than controls you
// touch, which is what belongs out here.
//
// FOUR OF THESE EIGHT ARE NOT COMPUTED YET. The operational quantities (TCHP,
// D26, thermocline, anomaly) show an em dash and a SOON badge rather than a
// zero or a plausible-looking placeholder, for the same reason an empty Argo
// layer says it is empty: a number you cannot distinguish from a real one is
// worse than no number.

function Stat({ label, value, unit, sub, soon, warn }) {
  return (
    <div className={`stat${soon ? ' soon' : ''}${warn ? ' warn' : ''}`}>
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        {soon && <span className="badge">SOON</span>}
      </div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

const DASH = '—'

export default function PinnedStats({ dataset }) {
  const selected = useVisualizationState((s) => s.selected)
  const variable = useVisualizationState((s) => s.variable)
  const probe = useProbe(dataset)
  const [server, setServer] = useState(null)
  const v = dataset.meta.volume

  // The authoritative value, straight from the source NetCDF at full precision.
  // Shown beside the client's own reading (which comes off the 8-bit texture)
  // so client/server drift is visible rather than hidden — the quantisation
  // step is 0.098 °C on the temperature clamp, and anything larger is a bug.
  useEffect(() => {
    if (!selected) { setServer(null); return undefined }
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

  const pinned = !!selected && !!probe
  const serverText = !server ? DASH
    : server.loading ? '…'
      : server.error ? 'error'
        : server.value == null ? DASH
          : server.value.toFixed(3)

  return (
    <div className="stats">
      <div className="stats-head">
        <span className="lbl">Pinned point</span>
        <span className="stats-where">
          {pinned
            ? `${selected.lat.toFixed(2)}°N ${selected.lon.toFixed(2)}°E`
            : 'nothing pinned'}
        </span>
      </div>

      <div className="stat-grid">
        <Stat
          label={v.variableShort ?? v.variableLabel}
          value={pinned && probe.value != null ? probe.value.toFixed(2) : DASH}
          unit={pinned && probe.value != null ? v.units : ''}
          sub={pinned
            ? (probe.value != null
              ? `level ${probe.level} of ${probe.levelCount}`
              : (probe.belowSeafloor ? 'below the seafloor' : `past the ${v.maxDepthM.toFixed(0)} m extent`))
            : ''}
        />
        <Stat
          label="Depth"
          value={pinned ? probe.depthM.toFixed(1) : DASH}
          unit={pinned ? 'm' : ''}
          sub={pinned ? 'depth cursor' : ''}
        />
        <Stat
          label="Seafloor"
          value={pinned && probe.seafloorM != null ? probe.seafloorM.toFixed(0) : DASH}
          unit={pinned && probe.seafloorM != null ? 'm' : ''}
          sub={pinned && probe.seafloorM != null && probe.seafloorM > v.maxDepthM
            ? `field stops at ${v.maxDepthM.toFixed(0)} m`
            : ''}
        />
        <Stat
          label="Server check"
          value={serverText}
          unit={server && !server.loading && !server.error && server.value != null ? v.units : ''}
          sub={server?.gridLat != null
            ? `cell ${server.gridLat.toFixed(2)}°, ${server.gridLon.toFixed(2)}°`
            : (pinned ? 'from the source NetCDF' : '')}
          warn={!!server?.error}
        />

        {/* Seated, not computed — see OPERATIONAL_LAYER_SPEC.md §3–§4. */}
        <Stat label="TCHP" value={DASH} sub="heat above 26 °C" soon />
        <Stat label="D26" value={DASH} sub="depth of the 26 °C isotherm" soon />
        <Stat label="Thermocline" value={DASH} sub="max |dT/dz|" soon />
        <Stat label="Anomaly" value={DASH} sub="vs the tile mean" soon />
      </div>
    </div>
  )
}
