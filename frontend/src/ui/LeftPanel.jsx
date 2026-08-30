import { useVisualizationState } from '../state/useVisualizationState.js'

function Slider({ label, value, min, max, step, format, onChange }) {
  return (
    <div className="group">
      <div className="slider-row">
        <span className="h-label">{label}</span>
        <span className="num">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

export default function LeftPanel({ dataset }) {
  const s = useVisualizationState()
  const vars = dataset.meta.variables
  const map = dataset.map
  const boxDepth = dataset.meta.bathymetry.boxDepth

  // depth-clip slider is in real metres; converted through the same depth curve
  const clipM = s.depthClip === 0 ? 0 : map.yToDepth(s.depthClip)
  const maxM = dataset.meta.bathymetry.bathyMaxM

  return (
    <div className="card overlay leftpanel">
      <h1>Ocean-Viz</h1>
      <div className="sub">{dataset.meta.regionLabel}</div>

      <div className="group">
        <span className="h-label">Variable</span>
        <div className="seg">
          {Object.entries(vars).map(([key, v]) => (
            <button
              key={key}
              className={s.variable === key ? 'on' : ''}
              disabled={!v.available}
              title={v.available ? v.label : `${v.label} — no data wired up yet`}
              onClick={() => v.available && s.setVariable(key)}
            >
              {v.label}
              {!v.available && <span className="soon">SOON</span>}
            </button>
          ))}
        </div>
      </div>

      <Slider
        label="Depth clip"
        value={s.depthClip} min={-boxDepth} max={0} step={0.02}
        format={() => (s.depthClip === 0 ? 'off' : `${clipM.toFixed(0)} m`)}
        onChange={s.setDepthClip}
      />

      <Slider
        label="Opacity"
        value={s.density} min={0.004} max={0.12} step={0.002}
        format={(v) => v.toFixed(3)}
        onChange={s.setDensity}
      />

      <Slider
        label="Vertical exaggeration"
        value={s.vertExag} min={0.25} max={3} step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={s.setVertExag}
      />

      <Slider
        label="Fly speed"
        value={s.flySpeed} min={2} max={120} step={1}
        format={(v) => `${v.toFixed(0)} u/s`}
        onChange={s.setFlySpeed}
      />

      <div className="group">
        <span className="h-label">Navigation</span>
        <div className="seg">
          <button className={s.navMode === 'fly' ? 'on' : ''} onClick={() => s.setNavMode('fly')}>
            Fly
          </button>
          <button className={s.navMode === 'orbit' ? 'on' : ''} onClick={() => s.setNavMode('orbit')}>
            Orbit
          </button>
        </div>
        <button className="home-btn" onClick={s.goHome} title="Reset to the default view (H)">
          ⌂ Home view <span className="kbdhint">H</span>
        </button>
      </div>

      <div className="group">
        <label className="check">
          <input type="checkbox" checked={s.showDetail}
            onChange={(e) => s.setShowDetail(e.target.checked)} />
          <span>Synthetic seafloor texture</span>
        </label>
      </div>

      <div className="rule" style={{ margin: '4px 0 11px' }} />
      <div className="h-label" style={{ lineHeight: 1.7 }}>
        depth range 0–{maxM.toFixed(0)} m<br />
        grid {dataset.meta.volume.W}×{dataset.meta.volume.levelsReal}×{dataset.meta.volume.D}<br />
        {(dataset.meta.volume.nanFraction * 100).toFixed(1)}% land / no-data
      </div>
    </div>
  )
}
