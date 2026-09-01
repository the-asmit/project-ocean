import { useEffect } from 'react'
import { IconButton } from '../ui/Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { useProbe } from './useProbe.js'
import { IconCollapse } from '../ui/icons.jsx'

// The depth cursor, in the canvas.
//
// It sits here rather than in a rail group because it is not a setting: it is
// spatially tied to the pin, it moves a marker that is drawn in this scene, and
// the ring it drives is a few centimetres away on screen. Putting it behind a
// rail icon would have made the one control that is *about* a place in the
// volume the only one you had to leave the volume to reach.
//
// This carries the INTERACTIVE half of the old Pinned-point panel. The
// read-only half — the server-verified value, the grid cell it came from, the
// dataset provenance — belongs outside the canvas with the other read-only
// readouts.
//
// Appears only with a pin, so an unpinned canvas stays clean.

export default function PinnedControls({ dataset }) {
  const selected = useVisualizationState((s) => s.selected)
  const clearSelected = useVisualizationState((s) => s.clearSelected)
  const setProbeIndex = useVisualizationState((s) => s.setProbeIndex)
  const probe = useProbe(dataset)
  const units = dataset.meta.volume.units
  const maxDataM = dataset.meta.volume.maxDepthM

  // Arrow keys step one model level, exactly as they did in the rail panel.
  useEffect(() => {
    if (!probe) return undefined
    const onKey = (e) => {
      if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      const next = probe.index + (e.code === 'ArrowDown' ? 1 : -1)
      setProbeIndex(Math.min(probe.levelCount - 1, Math.max(0, next)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [probe, setProbeIndex])

  if (!selected || !probe) return null
  const dead = probe.value == null

  return (
    <div className="pinned-controls">
      <div className="pc-head">
        <span className="dot" />
        <span className="lbl">Pinned point</span>
        <span className="spacer" />
        <IconButton label="Clear pin (Esc)" onClick={clearSelected}>
          <IconCollapse size={12} />
        </IconButton>
      </div>

      <div className="pc-where">
        {selected.lat.toFixed(3)}°N&ensp;{selected.lon.toFixed(3)}°E
      </div>

      <div className="srow">
        <label className="lbl" htmlFor="sl-depth-cursor">Depth cursor</label>
        <span className="num">L{probe.level} · {probe.depthM.toFixed(1)} m</span>
      </div>
      <input
        id="sl-depth-cursor" type="range"
        min={0} max={probe.levelCount - 1} step={1} value={probe.index}
        onChange={(e) => setProbeIndex(parseInt(e.target.value, 10))}
      />

      <div className={`probe-read${dead ? ' dead' : ''}`}>
        {dead ? (
          <span className="why">
            {probe.belowSeafloor
              ? 'below the seafloor here'
              : `no value — past the ${maxDataM.toFixed(0)} m extent`}
          </span>
        ) : (
          <>
            <span className="big">{probe.value.toFixed(2)}</span>
            <span className="unit">{units}</span>
          </>
        )}
      </div>

      <div className="hint">
        Level {probe.level} of {probe.levelCount} · ↑ ↓ steps one level.
        {probe.seafloorM != null && ` Seafloor ${probe.seafloorM.toFixed(0)} m.`}
      </div>
    </div>
  )
}
