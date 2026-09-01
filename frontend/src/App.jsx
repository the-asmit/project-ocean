import { Suspense, lazy, useEffect, useRef } from 'react'
import AppBar from './ui/AppBar.jsx'
import ScenePanel from './ui/ScenePanel.jsx'
import TransectChart from './charts/TransectChart.jsx'
import ProfileChart from './charts/ProfileChart.jsx'
import { IconAlert } from './ui/icons.jsx'
import { loadDataset } from './scene/dataset.js'
import { isoRange } from './scene/isoRange.js'
import { useVisualizationState } from './state/useVisualizationState.js'
import { useColorScale } from './state/useColorScale.js'
import { DEFAULT_PALETTE } from './scene/colorScale.js'
import { spanDecimals } from './ui/variableTerms.js'
import { useCurrentsState, useCurrentsData } from './currents/useCurrentsState.js'
import { useArgoState, useGliderTracks } from './observations/useObservations.js'
import { useHashRoute } from './router.js'

// Docs carries 250 kB of Markdown and Roadmap pulls in the spec; neither belongs
// in the Explorer bundle, so both load on demand.
const DocsPage = lazy(() => import('./pages/DocsPage.jsx'))
const RoadmapPage = lazy(() => import('./pages/RoadmapPage.jsx'))

// P3: the synthetic-vs-real disclosure is not optional and not decoration. It
// lives in the footer now — always on screen, never behind a panel.
function SourceNote({ dataset }) {
  const showDetail = useVisualizationState((s) => s.showDetail)
  const clipIndex = useVisualizationState((s) => s.clipIndex)
  const westIndex = useVisualizationState((s) => s.westIndex)
  const showArgo = useVisualizationState((s) => s.showArgo)
  const showIso = useVisualizationState((s) => s.showIso)
  const isoValue = useVisualizationState((s) => s.isoValue)
  const showCurrents = useCurrentsState((s) => s.showCurrents)
  const frame = useCurrentsState((s) => s.frame)
  const currents = useCurrentsData(dataset)
  const showGliders = useVisualizationState((s) => s.showGliders)
  const gliderStats = useVisualizationState((s) => s.gliderStats)
  const argo = useArgoState(dataset)
  const gliders = useGliderTracks(dataset)
  const paletteId = useVisualizationState((s) => s.palette)
  const scale = useColorScale(dataset)
  const v = dataset.meta.volume
  const curve = dataset.meta.bathymetry.depthCurve
  // Slicing replaces the stylized top face with a real horizontal section, so
  // the stylized-surface disclosure stops being true the moment the block is
  // cut. Disclosing something that isn't on screen is as wrong as failing to
  // disclose something that is.
  const sliced = clipIndex > 0
  const westSliced = westIndex > 0
  const cutNames = [
    sliced && 'top face',
    westSliced && 'west face',
  ].filter(Boolean).join(' and ')
  return (
    <>
      <span className="src">
        <b>SOURCE</b>&ensp;{v.variableLabel} ({v.variable}
        {v.unitsAttr ? `, CF units ${v.unitsAttr}` : ''}) and seafloor: real{' '}
        {v.source} / Copernicus Marine
      </span>
      <span className="dot">·</span>
      <span className={showDetail && !sliced ? 'synth' : undefined}>
        {sliced || westSliced
          ? `Sliced — ${cutNames} ${sliced && westSliced ? 'are' : 'is'} a REAL section through the field`
            + (sliced ? ', stylized surface removed' : '')
          : showDetail
            ? 'Block top face is STYLIZED shading, not imagery — cut faces are real data'
            : 'Stylized top face OFF — every rendered face is data'}
      </span>
      <span className="dot">·</span>
      <span>1/12° ≈ 9 km grid</span>
      {/* Real instruments now. The claim that matters is provenance and the
          window, because an Argo float does not profile on the model's date. */}
      {showArgo && argo.status === 'ready' && <span className="dot">·</span>}
      {showArgo && argo.status === 'ready' && (
        <span>
          Argo: {argo.floats.length} REAL float{argo.floats.length === 1 ? '' : 's'} from{' '}
          {argo.meta?.source}, profiled {argo.meta?.windowFrom}–{argo.meta?.windowTo}
          {' '}(±{argo.meta?.windowDays} d of the tile date)
        </span>
      )}
      {showArgo && argo.status === 'empty' && <span className="dot">·</span>}
      {showArgo && argo.status === 'empty' && (
        <span>No Argo float in this tile ±{argo.meta?.windowDays ?? 10} d — layer is empty, not hidden</span>
      )}
      {showGliders && <span className="dot">·</span>}
      {showGliders && (
        <span>
          {gliderStats
            ? `Glider ${gliderStats.deployment}: REAL ${gliderStats.meta?.source} track, `
              + `${gliderStats.meta?.dateFrom}–${gliderStats.meta?.dateTo}, `
              + `${gliderStats.meta?.dives} dives, ${gliderStats.meta?.rowsKept.toLocaleString()} of `
              + `${gliderStats.meta?.rowsRaw.toLocaleString()} samples drawn — no QC flags in source`
            : gliders.status === 'empty'
              ? 'No glider deployment in this tile — layer is empty, not hidden'
              : 'Gliders: OceanGliders GDAC'}
        </span>
      )}
      {/* Half of a 1000 m glider dive is below the model's own extent. */}
      {showGliders && gliderStats?.meta?.deeperThanModel > 0 && (
        <span className="dot">·</span>
      )}
      {showGliders && gliderStats?.meta?.deeperThanModel > 0 && (
        <span>
          {(gliderStats.meta.deeperThanModel * 100).toFixed(0)}% of that track is deeper than the{' '}
          {gliderStats.meta.modelMaxDepthM?.toFixed(0)} m model extent
        </span>
      )}
      {/* The isosurface is DERIVED, not synthetic and not stylized: marching
          cubes over the same bytes the cut faces sample. It says which, so it
          is never lumped in with the two disclosures either side of it. */}
      {showIso && <span className="dot">·</span>}
      {showIso && (
        <span>
          Isosurface {isoValue.toFixed(2)} {v.units} — REAL structure derived
          from the same {v.source} {v.variable} volume
        </span>
      )}
      {/* Real now. The spike's SYNTHETIC warning is gone because the claim it
          guarded is gone — these are measured uo/vo on the tile's own dates. */}
      {showCurrents && currents.status === 'ready' && <span className="dot">·</span>}
      {showCurrents && currents.status === 'ready' && (
        <span>
          Flow lines: REAL {currents.meta.source} uo/vo, {currents.meta.dates[
            Math.min(frame, currents.meta.dates.length - 1)]} — traced through
          the measured field
        </span>
      )}
      {/* Colour mapping, when it is no longer the one this variable ships
          with. The SCALE panel's badge says the same thing, but a screenshot
          of the 3D view alone would otherwise carry no record that these
          colours mean something other than the default. Silent when both are
          at their defaults, which is the ordinary case. */}
      {paletteId !== DEFAULT_PALETTE && <span className="dot">·</span>}
      {paletteId !== DEFAULT_PALETTE && (
        <span>Palette: {scale.palette.label}</span>
      )}
      {scale.custom && <span className="dot">·</span>}
      {scale.custom && (
        <span>
          Custom range {scale.lo.toFixed(spanDecimals(scale.hi - scale.lo))}–
          {scale.hi.toFixed(spanDecimals(scale.hi - scale.lo))} {v.units}
        </span>
      )}
      {/* scale.log, not the store's logScale: a request that was refused for
          a non-positive minimum leaves the colours linear, and the footer
          describes what is on screen. */}
      {scale.log && <span className="dot">·</span>}
      {scale.log && <span>Log colour scale</span>}
      <span className="dot opt">·</span>
      <span className="opt">Depth axis non-linearly exaggerated (curve {curve})</span>
    </>
  )
}

export default function App() {
  const route = useHashRoute()
  const dataset = useVisualizationState((s) => s.dataset)
  const setDataset = useVisualizationState((s) => s.setDataset)
  const loadError = useVisualizationState((s) => s.loadError)
  const setLoadError = useVisualizationState((s) => s.setLoadError)
  const region = useVisualizationState((s) => s.region)
  const date = useVisualizationState((s) => s.date)
  const variable = useVisualizationState((s) => s.variable)
  const clearSelected = useVisualizationState((s) => s.clearSelected)
  const goHome = useVisualizationState((s) => s.goHome)
  const setLoading = useVisualizationState((s) => s.setLoading)
  const setIsoValue = useVisualizationState((s) => s.setIsoValue)
  const cameraRef = useRef()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadDataset({ region, date, variable })
      .then((d) => {
        if (cancelled) return
        // Re-derive the isovalue for the NEW tile in the SAME commit as the
        // dataset. 20 is a temperature, not a salinity, and leaving the
        // correction to the SectionControls effect costs one render in which
        // the mesher builds an empty surface and immediately throws it away.
        const r = isoRange(d)
        const cur = useVisualizationState.getState().isoValue
        if (!(cur >= r.lo && cur <= r.hi)) setIsoValue(r.start)
        setDataset(d)
        setLoading(false)
      })
      .catch((e) => { if (!cancelled) { setLoadError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [region, date, variable, setDataset, setLoadError, setLoading, setIsoValue])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'KeyH') goHome()
      if (e.code === 'Escape') clearSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelected, goHome])

  // Routed AFTER every hook, so the hook count never changes between renders.
  // The tile keeps loading in the background while a page is open, which is why
  // switching back to Explorer is instant.
  if (route === 'docs' || route === 'roadmap') {
    return (
      <div className="app page">
        <AppBar dataset={dataset} route={route} />
        <Suspense fallback={<div className="page-body page-load">Loading…</div>}>
          {route === 'docs' ? <DocsPage /> : <RoadmapPage />}
        </Suspense>
      </div>
    )
  }

  if (loadError && !dataset) {
    return (
      <div className="err">
        <div className="box">
          <h2><IconAlert size={13} style={{ verticalAlign: -1, marginRight: 6 }} />Could not load the dataset</h2>
          <p>{loadError}</p>
          <p>
            The backend serves the GLORYS tile and its derived render products.
            Start it, then reload:
          </p>
          <code>cd backend &amp;&amp; .venv/bin/uvicorn main:app --port 8000</code>
        </div>
      </div>
    )
  }

  if (!dataset) {
    return (
      <div className="boot">
        <div className="inner">
          <div className="t">Loading GLORYS tile</div>
          <div className="s">volume · bathymetry · depth LUT</div>
          <div className="bar"><i /></div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <AppBar dataset={dataset} route={route} />

      {/* No rails. Every control moved into the canvas (see SceneRail), so the
          scene gets the full width and what is left outside it is read-only:
          the charts, and the provenance strip. */}
      <div className="center">
        <ScenePanel dataset={dataset} cameraRef={cameraRef} />
        <div className="charts">
          <ProfileChart dataset={dataset} />
          <TransectChart dataset={dataset} />
        </div>
      </div>

      <footer className="appfoot">
        <SourceNote dataset={dataset} />
        <span className="spacer" />
        <span className="opt">WGS 84 · EPSG:4326</span>
      </footer>
    </div>
  )
}
