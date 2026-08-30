import Panel from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { IconHome, IconOrbit, IconCheck } from './icons.jsx'

function Slider({ label, value, min, max, step, format, onChange, hint }) {
  const id = `sl-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div className="field">
      <div className="srow">
        <label className="lbl" htmlFor={id}>{label}</label>
        <span className="num">{format(value)}</span>
      </div>
      <input
        id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint && <div className="hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export default function RenderControls({ dataset }) {
  const s = useVisualizationState()
  const { boxDepth, bathyMaxM, depthCurve } = dataset.meta.bathymetry
  const clipM = s.depthClip === 0 ? 0 : dataset.map.yToDepth(s.depthClip)

  return (
    <>
      <Panel title="Section" sub={`curve ${depthCurve}`}>
        <Slider
          label="Slice from top" value={s.depthClip} min={-boxDepth * 0.985} max={0} step={0.02}
          format={() => (s.depthClip === 0 ? 'off' : `${clipM.toFixed(0)} m`)}
          onChange={s.setDepthClip}
          hint="Cuts the block down from the surface. The new top face is a horizontal section at that depth."
        />
        <Slider
          label="Vertical exaggeration" value={s.vertExag} min={3} max={30} step={0.5}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={s.setVertExag}
          hint={`0–${bathyMaxM.toFixed(0)} m compressed by the ${depthCurve} depth curve, then scaled. The ruler reads true metres.`}
        />
        <div className="field">
          <button
            type="button"
            className={`layer${s.showContours ? ' on' : ''}`}
            aria-pressed={s.showContours}
            onClick={() => s.setShowContours(!s.showContours)}
          >
            <span className="tick"><IconCheck size={9} /></span>
            <span className="name">Isotherm contours</span>
            <span className="badge">2 °C</span>
          </button>
        </div>
      </Panel>

      <Panel title="View" sub="orbit">
        <p className="hint" style={{ margin: '0 0 11px' }}>
          <IconOrbit size={11} style={{ verticalAlign: -1, marginRight: 6 }} />
          Drag to turn the block · scroll to zoom. Free-fly moves to the
          fullscreen deep-dive.
        </p>
        <button type="button" className="btn" onClick={s.goHome}>
          <IconHome size={12} /> Reset view <kbd>H</kbd>
        </button>
      </Panel>
    </>
  )
}
