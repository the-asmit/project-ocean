import { useEffect, useRef, useState } from 'react'
import Panel, { IconButton } from './Panel.jsx'
import OceanScene from '../scene/OceanScene.jsx'
import HUDLabel from '../interaction/HUDLabel.jsx'
import DepthRuler from './DepthRuler.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { IconExpand, IconCollapse, IconHome } from './icons.jsx'

// The 3D view, bounded. Nothing inside OceanScene changed — it just sizes to a
// panel instead of the window now, and R3F picks up the resize itself.
export default function ScenePanel({ dataset, cameraRef }) {
  const hostRef = useRef()
  const [expanded, setExpanded] = useState(false)
  const goHome = useVisualizationState((s) => s.goHome)
  const b = dataset.meta.bbox

  // Esc leaves the deep-dive before it reaches the clear-pin handler.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e) => {
      if (e.code === 'Escape') { e.stopPropagation(); setExpanded(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [expanded])

  return (
    <Panel
      className={`scene-panel${expanded ? ' expanded' : ''}`}
      title="3D volume"
      sub={`${dataset.meta.regionLabel} · ${b.lat_min}–${b.lat_max}°N ${b.lon_min}–${b.lon_max}°E`}
      bodyClass="flush"
      tools={
        <>
          <IconButton label="Home view (H)" onClick={goHome}><IconHome size={13} /></IconButton>
          <IconButton
            label={expanded ? 'Exit full view (Esc)' : 'Full view'}
            active={expanded}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? <IconCollapse size={13} /> : <IconExpand size={13} />}
          </IconButton>
        </>
      }
    >
      <div className="scene-host" ref={hostRef}>
        <OceanScene dataset={dataset} cameraRef={cameraRef} />
        <HUDLabel cameraRef={cameraRef} hostRef={hostRef} />
        <DepthRuler cameraRef={cameraRef} hostRef={hostRef} dataset={dataset} />

        <div className="scene-legend">
          <span><i style={{ background: '#4fc3f7' }} /> cursor</span>
          <span><i style={{ background: '#ffc46b' }} /> pinned</span>
          <span><i style={{ background: '#0d1729' }} /> no data below {dataset.meta.volume.maxDepthM.toFixed(0)} m</span>
          <span><i style={{ background: '#2b3038' }} /> below seafloor</span>
        </div>

        <div className="scene-foot">
          <div className="navhint">
            <b>ORBIT</b>&ensp;drag to turn the block&ensp;·&ensp;scroll to zoom&ensp;·&ensp;
            <kbd>H</kbd> reset&ensp;·&ensp;hover a cut face to read&ensp;·&ensp;click to pin
          </div>
        </div>
      </div>
    </Panel>
  )
}
