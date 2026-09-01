import { useEffect, useRef } from 'react'
import Panel, { IconButton } from './Panel.jsx'
import OceanScene from '../scene/OceanScene.jsx'
import HUDLabel from '../interaction/HUDLabel.jsx'
import DepthRuler from './DepthRuler.jsx'
import SectionBadge from './SectionBadge.jsx'
import SceneRail from './rail/SceneRail.jsx'
import PinnedControls from '../interaction/PinnedControls.jsx'
import TimelineControls from './TimelineControls.jsx'
import { useCurrentsState, useCurrentsData } from '../currents/useCurrentsState.js'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { IconExpand, IconCollapse, IconHome } from './icons.jsx'

// The 3D view, and everything drawn over it.
//
// FULLSCREEN carries no controls of its own. It used to mount a SECOND copy of
// the section controls, because the right rail it covered was where they lived —
// which made it the app's last duplicate control path, and left the Scale panel
// unreachable while expanded. Every control is inside .scene-host now, so they
// come along by construction and this toggle only changes how much room the
// canvas gets. Only the 3D panel has it; the map is a map.
export default function ScenePanel({ dataset, cameraRef }) {
  const hostRef = useRef()
  const goHome = useVisualizationState((s) => s.goHome)
  const expanded = useVisualizationState((s) => s.sceneExpanded)
  const setExpanded = useVisualizationState((s) => s.setSceneExpanded)
  const loading = useVisualizationState((s) => s.loading)
  const loadError = useVisualizationState((s) => s.loadError)
  // still needed by the on-canvas REAL CURRENTS chip; only the fullscreen
  // duplicate's setters went with it
  const showCurrents = useCurrentsState((s) => s.showCurrents)
  const levelIndex = useCurrentsState((s) => s.levelIndex)
  const railPanel = useVisualizationState((s) => s.railPanel)
  const currents = useCurrentsData(dataset)
  const m = dataset.meta
  const isBox = String(m.region).startsWith('bbox:')

  // Esc leaves fullscreen before it reaches App's clear-pin handler: capture
  // phase, and it stops there. Leaving the view and dropping the pin on one
  // keypress would be two undos for one gesture.
  useEffect(() => {
    if (!expanded) return undefined
    const onKey = (e) => {
      if (e.code === 'Escape') { e.stopPropagation(); setExpanded(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [expanded, setExpanded])

  return (
    <Panel
      className={`scene-panel${expanded ? ' expanded' : ''}`}
      title="3D volume"
      sub={isBox
        ? `${m.regionLabel} · custom selection`
        : `${m.regionLabel} · ${m.bbox.lat_min}–${m.bbox.lat_max}°N ${m.bbox.lon_min}–${m.bbox.lon_max}°E`}
      bodyClass="flush"
      tools={
        <>
          <IconButton label="Home view (H)" onClick={goHome}><IconHome size={13} /></IconButton>
          <IconButton
            label={expanded ? 'Exit full view (Esc)' : 'Full view'}
            active={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <IconCollapse size={13} /> : <IconExpand size={13} />}
          </IconButton>
        </>
      }
    >
      {/* The rail's open panel is an overlay, so the canvas legends and hints
          move out from under it rather than being covered by it. */}
      <div className={`scene-host${railPanel ? ' rail-open' : ''}`} ref={hostRef}>
        <OceanScene dataset={dataset} cameraRef={cameraRef} />
        <HUDLabel cameraRef={cameraRef} hostRef={hostRef} />
        <DepthRuler cameraRef={cameraRef} hostRef={hostRef} dataset={dataset} />
        <SectionBadge dataset={dataset} />

        {/* Every interactive control lives in here now. */}
        <SceneRail dataset={dataset} cameraRef={cameraRef} />
        <PinnedControls dataset={dataset} />

        {loading && (
          <div className="scene-busy">
            <div className="card">
              <div className="t">Loading region</div>
              <div className="s">GLORYS subset · bathymetry · depth LUT</div>
              <div className="bar"><i /></div>
              <div className="s dim">Not cached yet? The Copernicus fetch takes ~1–2 min.</div>
            </div>
          </div>
        )}
        {loadError && !loading && (
          <div className="scene-busy">
            <div className="card err-card">
              <div className="t">Could not load that region</div>
              <div className="s">{String(loadError).slice(0, 180)}</div>
              <div className="s dim">The previous region is still shown.</div>
            </div>
          </div>
        )}

        <div className="scene-legend">
          <span><i style={{ background: '#4fc3f7' }} /> cursor</span>
          <span><i style={{ background: '#ffc46b' }} /> pinned</span>
          <span><i style={{ background: '#0d1729' }} /> no data below {dataset.meta.volume.maxDepthM.toFixed(0)} m</span>
          <span><i style={{ background: '#2b3038' }} /> below seafloor</span>
        </div>

        {/* Provenance on the canvas itself, not only in a panel — this said
            SYNTHETIC FIELD while the spike ran and now names the real source */}
        {showCurrents && currents.status === 'ready' && (
          <div className="flow-chip">
            REAL CURRENTS
            <em>
              GLORYS12V1 uo/vo ·{' '}
              {(() => {
                const d = currents.meta.depthLevels[
                  Math.min(currents.meta.depthLevels.length - 1, levelIndex)]
                // the shallowest model level is 0.49 m; toFixed(0) would call it "0 m"
                return d < 10 ? d.toFixed(1) : d.toFixed(0)
              })()} m
            </em>
          </div>
        )}

        <div className="scene-foot">
          <TimelineControls dataset={dataset} />
          <div className="navhint">
            <b>ORBIT</b>&ensp;drag to turn the block&ensp;·&ensp;scroll to zoom&ensp;·&ensp;
            <kbd>H</kbd> reset&ensp;·&ensp;hover a cut face to read&ensp;·&ensp;click to pin
          </div>
        </div>
      </div>
    </Panel>
  )
}
