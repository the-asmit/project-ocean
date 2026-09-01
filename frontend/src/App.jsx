import { Suspense, lazy, useEffect, useRef } from 'react'
import AppBar from './ui/AppBar.jsx'
import ScenePanel from './ui/ScenePanel.jsx'
import Minimap from './ui/Minimap.jsx'
import TransectChart from './charts/TransectChart.jsx'
import ProfileChart from './charts/ProfileChart.jsx'
import ComparisonPanel from './charts/ComparisonPanel.jsx'
import PinnedStats from './ui/PinnedStats.jsx'
import { IconAlert } from './ui/icons.jsx'
import { loadDataset } from './scene/dataset.js'
import { isoRange } from './scene/isoRange.js'
import { useVisualizationState } from './state/useVisualizationState.js'
import { useColorScale } from './state/useColorScale.js'
import { THRESHOLD } from './scene/heatPotential.js'
import { DEFAULT_PALETTE } from './scene/colorScale.js'
import { spanDecimals } from './ui/variableTerms.js'
import { useCurrentsState, useCurrentsData } from './currents/useCurrentsState.js'
import { useArgoState, useGliderTracks } from './observations/useObservations.js'
import { useHashRoute } from './router.js'

// Docs carries 250 kB of Markdown and Roadmap pulls in the spec; neither belongs
// in the Explorer bundle, so both load on demand.
const DocsPage = lazy(() => import('./pages/DocsPage.jsx'))
const RoadmapPage = lazy(() => import('./pages/RoadmapPage.jsx'))

// Two ISO dates as one range, dropping the repeated year: an Argo window and a
// glider deployment both sit inside one year in every real case, and
// "2026-06-01–2026-06-21" spends ten characters saying 2026 twice.
function span(from, to) {
  if (!from || !to) return `${from ?? ''}–${to ?? ''}`
  return from.slice(0, 4) === to.slice(0, 4)
    ? `${from}–${to.slice(5)}`
    : `${from}–${to}`
}

// P3: the synthetic-vs-real disclosure is not optional and not decoration. It
// lives in the footer now — always on screen, never behind a panel.
function SourceNote({ dataset }) {
  const showDetail = useVisualizationState((s) => s.showDetail)
  const clipIndex = useVisualizationState((s) => s.clipIndex)
  const westIndex = useVisualizationState((s) => s.westIndex)
  const showArgo = useVisualizationState((s) => s.showArgo)
  const showIso = useVisualizationState((s) => s.showIso)
  const showHeat = useVisualizationState((s) => s.showHeat)
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

  // Colour choices are three separate facts but one sentence; as three clauses
  // they cost three separators and a wrap.
  const scaleBits = [
    paletteId !== DEFAULT_PALETTE && scale.palette.label,
    scale.custom && `custom ${scale.lo.toFixed(spanDecimals(scale.hi - scale.lo))}`
      + `–${scale.hi.toFixed(spanDecimals(scale.hi - scale.lo))} ${v.units}`,
    scale.log && 'log',
  ].filter(Boolean)

  return (
    <>
      <span className="src">
        <b>SOURCE</b>&ensp;{v.variableLabel} ({v.variable}
        {v.unitsAttr ? `, CF ${v.unitsAttr}` : ''}) + seafloor: real{' '}
        {v.source} / Copernicus
      </span>
      <span className="dot">·</span>
      <span className={showDetail && !sliced ? 'synth' : undefined}>
        {sliced || westSliced
          ? `Sliced — ${cutNames} ${sliced && westSliced ? 'are' : 'is'} REAL section`
            + (sliced ? ', stylized surface removed' : '')
          : showDetail
            ? 'Top face STYLIZED, not imagery; cut faces are real'
            : 'Stylized top face OFF — every rendered face is data'}
      </span>
      <span className="dot">·</span>
      <span>1/12° ≈ 9 km</span>
      {/* Real instruments. The claim that matters is provenance and the
          window, because an Argo float does not profile on the model's date. */}
      {showArgo && argo.status === 'ready' && <span className="dot">·</span>}
      {showArgo && argo.status === 'ready' && (
        <span>
          {argo.meta?.source}: {argo.floats.length} REAL float{argo.floats.length === 1 ? '' : 's'},{' '}
          {span(argo.meta?.windowFrom, argo.meta?.windowTo)}
          {' '}(±{argo.meta?.windowDays} d)
        </span>
      )}
      {showArgo && argo.status === 'empty' && <span className="dot">·</span>}
      {showArgo && argo.status === 'empty' && (
        <span>No Argo float here ±10 d — empty, not hidden</span>
      )}
      {showGliders && <span className="dot">·</span>}
      {showGliders && (
        <span>
          {gliderStats
            ? `Glider ${gliderStats.deployment}: REAL ${gliderStats.meta?.source}, `
              + `${span(gliderStats.meta?.dateFrom, gliderStats.meta?.dateTo)}, `
              + `${gliderStats.meta?.dives} dives, `
              + `${gliderStats.meta?.rowsKept.toLocaleString()}/`
              + `${gliderStats.meta?.rowsRaw.toLocaleString()} pts, no QC in source`
              // Half of a 1000 m glider dive is below the model's own extent.
              + (gliderStats.meta?.deeperThanModel > 0
                ? `, ${(gliderStats.meta.deeperThanModel * 100).toFixed(0)}% below the `
                  + `${gliderStats.meta.modelMaxDepthM?.toFixed(0)} m extent`
                : '')
            : gliders.status === 'empty'
              ? 'No glider deployment here — empty, not hidden'
              : 'Gliders: OceanGliders GDAC'}
        </span>
      )}
      {/* The isosurface is DERIVED, not synthetic and not stylized: marching
          tetrahedra over the same bytes the cut faces sample. */}
      {showIso && <span className="dot">·</span>}
      {showIso && (
        <span>
          Isosurface {isoValue.toFixed(2)} {v.units} — DERIVED from the {v.variable} volume
        </span>
      )}
      {/* The operational layer. DERIVED, like the isosurface and for the same
          reason — arithmetic on the same bytes the cut faces sample — but it
          also has to disclose that the absolute number depends on a choice of
          constants, so the formula is in the line rather than just the name. */}
      {showHeat && <span className="dot">·</span>}
      {showHeat && (
        <span>
          TCHP + D26 DERIVED — ρ·c_p∫(T−26)dz over the loaded volume, {THRESHOLD} kJ/cm²
          the cited threshold
        </span>
      )}
      {/* Measured uo/vo on the tile's own dates, not a model of a model. */}
      {showCurrents && currents.status === 'ready' && <span className="dot">·</span>}
      {showCurrents && currents.status === 'ready' && (
        <span>
          Flow: REAL uo/vo {currents.meta.dates[
            Math.min(frame, currents.meta.dates.length - 1)]}, traced through the
          measured field
        </span>
      )}
      {/* Colour mapping, when it is no longer the one this variable ships
          with. The SCALE panel's badge says the same thing, but a screenshot
          of the 3D view alone would otherwise carry no record that these
          colours mean something other than the default. */}
      {scaleBits.length > 0 && <span className="dot">·</span>}
      {scaleBits.length > 0 && <span>Scale: {scaleBits.join(' · ')}</span>}
      <span className="dot opt">·</span>
      <span className="opt">Depth axis exaggerated (curve {curve})</span>
      {/* Inline rather than pushed right by a flex spacer: a `flex: 1 1 auto`
          item in a WRAPPING flex row eats the rest of its line and shunts what
          follows onto a new one, which cost the footer a whole row in every
          state including the default. */}
      <span className="dot opt">·</span>
      <span className="opt">WGS 84 · EPSG:4326</span>
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
        {/* Two windows in the top row, as before the restructure: where the
            tile is, and the tile. The map is a sibling panel rather than an
            overlay — it is a working surface you drag on, not a legend. */}
        <Minimap dataset={dataset} cameraRef={cameraRef} />
        <ScenePanel dataset={dataset} cameraRef={cameraRef} />
        {/* Read-only outside the canvas: the numbers under the pin, then the
            three charts. Model-vs-float is a permanent panel rather than
            something that displaces the profile, so the model column and the
            comparison can be read together. */}
        <div className="charts">
          <PinnedStats dataset={dataset} />
          <ProfileChart dataset={dataset} />
          <TransectChart dataset={dataset} />
          <ComparisonPanel dataset={dataset} />
        </div>
      </div>

      <footer className="appfoot">
        <SourceNote dataset={dataset} />
      </footer>
    </div>
  )
}
