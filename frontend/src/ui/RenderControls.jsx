import Panel from './Panel.jsx'
import SectionControls from './SectionControls.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { IconHome, IconOrbit } from './icons.jsx'

export default function RenderControls({ dataset }) {
  const goHome = useVisualizationState((s) => s.goHome)
  const sceneExpanded = useVisualizationState((s) => s.sceneExpanded)

  return (
    <>
      {/* While expanded, the 3D view covers this rail and mounts its own copy.
          Rendering both would put duplicate ids in the DOM — the overlay's
          labels would focus the hidden inputs — and double the arrow-key
          handler. State lives in the store, so nothing is lost either way. */}
      {!sceneExpanded && <SectionControls dataset={dataset} />}

      <Panel title="View" sub="orbit">
        <p className="hint" style={{ margin: '0 0 11px' }}>
          <IconOrbit size={11} style={{ verticalAlign: -1, marginRight: 6 }} />
          Drag to turn the block · scroll to zoom. Free-fly moves to the
          fullscreen deep-dive.
        </p>
        <button type="button" className="btn" onClick={goHome}>
          <IconHome size={12} /> Reset view <kbd>H</kbd>
        </button>
      </Panel>
    </>
  )
}
