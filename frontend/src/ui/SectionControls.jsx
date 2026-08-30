import { useEffect, useMemo } from 'react'
import Panel from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { sliceStops, clipYForIndex, stopAt, westStops } from '../scene/sliceStops.js'
import { IconCheck } from './icons.jsx'

// The two slice controls and their companions, in ONE component.
//
// It renders in two places — the right rail, and the fullscreen 3D view, which
// covers that rail — so the slice logic has exactly one definition and the two
// mounts read the same store. The fullscreen view must not be less capable than
// the docked one.
//
// Only ONE mount exists at a time — the rail unmounts its copy while the view
// is expanded — so ids stay unique and the arrow-key handler is never doubled.

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

export default function SectionControls({ dataset, compact = false }) {
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

  // The west-east cut, the same pattern one axis over.
  const wStops = useMemo(() => westStops(dataset), [dataset])
  const wStop = s.westIndex > 0 ? wStops[Math.min(wStops.length - 1, s.westIndex - 1)] : null
  const setWest = (i) =>
    s.setWestIndex(Math.round(Math.min(wStops.length, Math.max(0, i))))
  const westLabel = wStop ? `${wStop.lon.toFixed(2)}°E` : 'off'

  const sliceLabel = !stop
    ? 'off'
    : stop.real
      ? `L${stop.level} · ${stop.depthM.toFixed(1)} m`
      : `${stop.depthM.toFixed(0)} m · no data`

  // The overlay has the 3D view right beside it, so the long explanatory hints
  // are noise there — the slider readouts already say what is happening.
  const hint = (text) => (compact ? undefined : text)

  return (
    <Panel title="Section" sub={`curve ${depthCurve}`}>
      <Slider
        label="Slice from top" value={s.clipIndex} min={0} max={stops.length} step={1}
        format={() => sliceLabel}
        onChange={setIndex}
        hint={
          stop && !stop.real
            ? `Below the ${maxDataM.toFixed(0)} m extent of ${dataset.meta.volume.variableLabel} — the section shows no value here.`
            : hint(`Cuts the block down from the surface; the new top face is a horizontal section. Snaps to the ${stops.filter((x) => x.real).length} real model levels. ← → steps one level.`)
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
        label="Slice from west" value={s.westIndex} min={0} max={wStops.length} step={1}
        format={() => westLabel}
        onChange={setWest}
        hint={hint(`Cuts the block in from the west edge; the new face is a N–S section. Snaps to the ${wStops.length} model longitude columns it can reach. Independent of the depth slice — use both together.`)}
      />
      <Slider
        label="Vertical exaggeration" value={s.vertExag} min={3} max={30} step={0.5}
        format={(v) => `${v.toFixed(1)}×`}
        onChange={s.setVertExag}
        hint={hint(`0–${bathyMaxM.toFixed(0)} m compressed by the ${depthCurve} depth curve, then scaled. The ruler reads true metres.`)}
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
  )
}
