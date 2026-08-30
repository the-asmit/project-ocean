import { useEffect, useRef } from 'react'
import AppBar from './ui/AppBar.jsx'
import ScenePanel from './ui/ScenePanel.jsx'
import Minimap from './ui/Minimap.jsx'
import DataLayersPanel from './ui/DataLayersPanel.jsx'
import RenderControls from './ui/RenderControls.jsx'
import Colorbar from './ui/Colorbar.jsx'
import InfoPanel from './ui/InfoPanel.jsx'
import TransectChart from './charts/TransectChart.jsx'
import ProfileChart from './charts/ProfileChart.jsx'
import { IconAlert } from './ui/icons.jsx'
import { loadDataset } from './scene/dataset.js'
import { useVisualizationState } from './state/useVisualizationState.js'

// P3: the synthetic-vs-real disclosure is not optional and not decoration. It
// lives in the footer now — always on screen, never behind a panel.
function SourceNote({ dataset }) {
  const showDetail = useVisualizationState((s) => s.showDetail)
  const v = dataset.meta.volume
  const curve = dataset.meta.bathymetry.depthCurve
  return (
    <>
      <span className="src">
        <b>SOURCE</b>&ensp;{v.variableLabel} and seafloor: real {v.source} / Copernicus Marine
      </span>
      <span className="dot">·</span>
      <span className={showDetail ? 'synth' : undefined}>
        {showDetail
          ? 'Block top face is STYLIZED shading, not imagery — cut faces are real data'
          : 'Stylized top face OFF — every rendered face is data'}
      </span>
      <span className="dot">·</span>
      <span>1/12° ≈ 9 km grid</span>
      <span className="dot opt">·</span>
      <span className="opt">Depth axis non-linearly exaggerated (curve {curve})</span>
    </>
  )
}

export default function App() {
  const dataset = useVisualizationState((s) => s.dataset)
  const setDataset = useVisualizationState((s) => s.setDataset)
  const loadError = useVisualizationState((s) => s.loadError)
  const setLoadError = useVisualizationState((s) => s.setLoadError)
  const region = useVisualizationState((s) => s.region)
  const date = useVisualizationState((s) => s.date)
  const variable = useVisualizationState((s) => s.variable)
  const clearSelected = useVisualizationState((s) => s.clearSelected)
  const goHome = useVisualizationState((s) => s.goHome)
  const cameraRef = useRef()

  useEffect(() => {
    let cancelled = false
    loadDataset({ region, date, variable })
      .then((d) => !cancelled && setDataset(d))
      .catch((e) => !cancelled && setLoadError(String(e)))
    return () => { cancelled = true }
  }, [region, date, variable, setDataset, setLoadError])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'KeyH') goHome()
      if (e.code === 'Escape') clearSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelected, goHome])

  if (loadError) {
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
      <AppBar dataset={dataset} />

      <div className="rail left">
        <DataLayersPanel dataset={dataset} />
      </div>

      <div className="center">
        <Minimap dataset={dataset} cameraRef={cameraRef} />
        <ScenePanel dataset={dataset} cameraRef={cameraRef} />
        <ProfileChart dataset={dataset} />
        <TransectChart dataset={dataset} />
      </div>

      <div className="rail right">
        <RenderControls dataset={dataset} />
        <Colorbar dataset={dataset} />
        <InfoPanel dataset={dataset} />
      </div>

      <footer className="appfoot">
        <SourceNote dataset={dataset} />
        <span className="spacer" />
        <span className="opt">WGS 84 · EPSG:4326</span>
      </footer>
    </div>
  )
}
