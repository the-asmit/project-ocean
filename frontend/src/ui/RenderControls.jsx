import { useEffect, useMemo } from 'react'
import Panel from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { sliceStops, clipYForIndex, stopAt } from '../scene/sliceStops.js'
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
  const { bathyMaxM, depthCurve } = dataset.meta.bathymetry
  const maxDataM = dataset.meta.volume.maxDepthM

  // Every slider position lands on a depth the model actually carries, unless
  // the user has opted into the abyss below the variable's extent.
  const stops = useMemo(
    () => sliceStops(dataset, s.sliceExtended),
    [dataset, s.sliceExtended],
  )
  const stop = stopAt(stops, s.clipIndex)
  const setIndex = (i) => {
    const n = Math.round(Math.min(stops.length, Math.max(0, i)))
    s.setSlice(n, clipYForIndex(dataset, stops, n))
  }

  // Step the slice a level at a time without having to focus the slider first.
  // Guarded so it never steals arrows from a focused control.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      setIndex(s.clipIndex + (e.code === 'ArrowRight' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const sliceLabel = !stop
    ? 'off'
    : stop.real
      ? `L${stop.level} · ${stop.depthM.toFixed(1)} m`
      : `${stop.depthM.toFixed(0)} m · no data`

  return (
    <>
      <Panel title="Section" sub={`curve ${depthCurve}`}>
        <Slider
          label="Slice from top" value={s.clipIndex} min={0} max={stops.length} step={1}
          format={() => sliceLabel}
          onChange={setIndex}
          hint={
            stop && !stop.real
              ? `Below the ${maxDataM.toFixed(0)} m extent of ${dataset.meta.volume.variableLabel} — the section shows no value here.`
              : `Cuts the block down from the surface; the new top face is a horizontal section. Snaps to the ${stops.filter((x) => x.real).length} real model levels. ← → steps one level.`
          }
        />
        <div className="field">
          <button
            type="button"
            className={`layer${s.sliceExtended ? ' on' : ''}`}
            aria-pressed={s.sliceExtended}
            onClick={() => {
              const next = !s.sliceExtended
              // leaving extended mode: pull the slice back inside the data
              if (!next && stop && !stop.real) setIndex(sliceStops(dataset, false).length)
              s.setSliceExtended(next)
            }}
          >
            <span className="tick"><IconCheck size={9} /></span>
            <span className="name">Extend below data extent</span>
            <span className="badge">{bathyMaxM.toFixed(0)} m</span>
          </button>
        </div>
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
