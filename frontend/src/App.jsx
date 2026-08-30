import { useEffect, useRef } from 'react'
import OceanScene from './scene/OceanScene.jsx'
import HUDLabel from './interaction/HUDLabel.jsx'
import LeftPanel from './ui/LeftPanel.jsx'
import Colorbar from './ui/Colorbar.jsx'
import TopBar from './ui/TopBar.jsx'
import InfoPanel from './ui/InfoPanel.jsx'
import Minimap from './ui/Minimap.jsx'
import { loadDataset } from './scene/dataset.js'
import { useVisualizationState } from './state/useVisualizationState.js'

// P3: the synthetic-vs-real disclosure is not optional and not decoration.
function SourceNote({ dataset }) {
  const showDetail = useVisualizationState((s) => s.showDetail)
  const curve = dataset.meta.bathymetry.depthCurve
  return (
    <div className="overlay source-note">
      <b>SOURCE</b> — seafloor shape and all {dataset.meta.volume.variableLabel.toLowerCase()}{' '}
      values are real {dataset.meta.volume.source} / Copernicus Marine.
      {showDetail
        ? ' Sub-grid seafloor surface texture is SYNTHETIC (decorative, zero-mean, ±0.14 world-units) — the real grid is 1/12°≈9 km.'
        : ' Synthetic surface texture is OFF — seafloor is pure interpolated data.'}
      {' '}Depth axis is non-linearly exaggerated (curve {curve}) to make shelf and abyss legible together.
    </div>
  )
}

function NavHint() {
  const navMode = useVisualizationState((s) => s.navMode)
  const toggle = useVisualizationState((s) => s.toggleNavMode)
  return (
    <div className="card overlay navhint" style={{ pointerEvents: 'auto' }}>
      {navMode === 'fly' ? (
        <>
          <b>FLY</b> · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move ·{' '}
          <kbd>Q</kbd>/<kbd>E</kbd> down/up · <kbd>Shift</kbd> boost · drag to look · scroll speed
        </>
      ) : (
        <>
          <b>ORBIT</b> · drag to orbit · scroll to zoom
        </>
      )}
      {' '}· <kbd>F</kbd> to switch (
      <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={toggle}>toggle</span>
      ) · hover to read · click to pin
    </div>
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
  const toggleNavMode = useVisualizationState((s) => s.toggleNavMode)
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
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'KeyF') toggleNavMode()
      if (e.code === 'KeyH') goHome()
      if (e.code === 'Escape') clearSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleNavMode, clearSelected, goHome])

  if (loadError) {
    return (
      <div className="err">
        <b>Could not load the dataset.</b>
        <br />{loadError}
        <br /><br />
        Is the backend running? <code>cd backend &amp;&amp; uvicorn main:app --port 8000</code>
      </div>
    )
  }
  if (!dataset) return <div className="loading">loading GLORYS tile…</div>

  return (
    <>
      <OceanScene dataset={dataset} cameraRef={cameraRef} />
      <HUDLabel cameraRef={cameraRef} />
      <TopBar dataset={dataset} />
      <LeftPanel dataset={dataset} />
      <Colorbar dataset={dataset} />
      <Minimap dataset={dataset} cameraRef={cameraRef} />
      <InfoPanel dataset={dataset} />
      <SourceNote dataset={dataset} />
      <NavHint />
    </>
  )
}
