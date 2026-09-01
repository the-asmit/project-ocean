import { IconButton } from './Panel.jsx'
import TopNav from './TopNav.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { IconWave, IconHome, IconHelp } from './icons.jsx'

// One header for all three pages. The context cells and the view actions
// describe a loaded tile, so they stand down on Docs and Roadmap rather than
// being duplicated into a second, nearly-identical bar.
export default function AppBar({ dataset, route = 'explorer' }) {
  const m = dataset?.meta
  const goHome = useVisualizationState((s) => s.goHome)
  const b = m?.bbox
  const deg = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`
  const onExplorer = route === 'explorer'

  return (
    <header className="appbar">
      <div className="brand">
        <IconWave size={19} className="mark" />
        <div>
          <div className="name">Ocean-Viz</div>
          <div className="tag">Volumetric ocean explorer</div>
        </div>
      </div>

      <TopNav route={route} />

      {onExplorer && m && (
        <div className="ctx">
          <div className="cell">
            <span className="k">Model</span>
            <span className="v"><em>{m.volume.source}</em> · 1/12°</span>
          </div>
          <div className="cell">
            <span className="k">Date</span>
            <span className="v">{m.date}</span>
          </div>
          <div className="cell">
            <span className="k">Region</span>
            <span className="v">
              {deg(b.lat_min, 'N', 'S')}–{deg(b.lat_max, 'N', 'S')}&ensp;
              {deg(b.lon_min, 'E', 'W')}–{deg(b.lon_max, 'E', 'W')}
            </span>
          </div>
          <div className="cell">
            <span className="k">Field</span>
            <span className="v">
              {m.volume.variableLabel} {m.volume.units} · 0–{m.volume.maxDepthM.toFixed(0)} m
            </span>
          </div>
        </div>
      )}

      <span className="spacer" />

      <div className="actions">
        {onExplorer && (
          <IconButton label="Home view (H)" onClick={goHome}><IconHome size={14} /></IconButton>
        )}
        <IconButton
          label="Controls: drag to orbit · scroll to zoom · H home · Esc clear pin · ← → step the depth slice · ↑ ↓ step the depth cursor"
        >
          <IconHelp size={14} />
        </IconButton>
      </div>
    </header>
  )
}
