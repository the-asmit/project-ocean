import { useCurrentsState, useCurrentsData, usePlayLoop } from '../currents/useCurrentsState.js'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { IconPlay, IconPause, IconPrev, IconNext } from './icons.jsx'

// The time scrubber for the real current field.
//
// Labels are REAL GLORYS dates now. During the spike they were relative T+
// offsets specifically so a fabricated frame could never be mistaken for the
// app bar's real date; that reason is gone, and printing the actual day is
// what makes the animation legible as a week of ocean.

export default function TimelineControls({ dataset }) {
  const s = useCurrentsState()
  const data = useCurrentsData(dataset)
  // Touching the scrubber, transport or depth tabs is an explicit statement
  // about which field you are reading, so the panels follow.
  const setPanelLayer = useVisualizationState((v) => v.setPanelLayer)
  const act = (fn) => (...a) => { setPanelLayer('currents'); return fn(...a) }
  const dates = data.status === 'ready' ? data.meta.dates : []
  usePlayLoop(dates.length)

  if (!s.showCurrents) return null

  if (data.status !== 'ready') {
    return (
      <div className="timeline">
        <span className="tl-tag real">GLORYS12V1</span>
        <span className="tl-load">
          {data.status === 'error'
            ? `Currents unavailable — ${String(data.error).slice(0, 90)}`
            : 'Loading uo/vo …'}
        </span>
      </div>
    )
  }

  const levels = data.meta.depthLevels
  // three well-separated real model levels, not invented depths
  const picks = [0, levels.findIndex((d) => d >= 90), levels.findIndex((d) => d >= 300)]
    .filter((i) => i >= 0)

  return (
    <div className="timeline">
      <span className="tl-tag real">GLORYS12V1</span>

      <div className="tl-transport">
        <button type="button" onClick={act(() => s.step(-1, dates.length))} title="Previous day">
          <IconPrev size={11} />
        </button>
        <button
          type="button" className={s.playing ? 'on' : undefined}
          onClick={act(s.togglePlay)} aria-pressed={s.playing}
          title={s.playing ? 'Pause' : 'Play'}
        >
          {s.playing ? <IconPause size={11} /> : <IconPlay size={11} />}
        </button>
        <button type="button" onClick={act(() => s.step(1, dates.length))} title="Next day">
          <IconNext size={11} />
        </button>
      </div>

      <input
        className="tl-scrub" type="range" min={0} max={dates.length - 1} step={1}
        value={Math.min(s.frame, dates.length - 1)}
        onChange={act((e) => s.setFrame(parseInt(e.target.value, 10), dates.length))}
        aria-label="Date"
      />

      <span className="tl-clock">{dates[Math.min(s.frame, dates.length - 1)]}</span>
      <span className="tl-count">{Math.min(s.frame, dates.length - 1) + 1}/{dates.length}</span>

      <div className="tl-levels">
        {picks.map((i) => (
          <button
            key={i} type="button"
            className={i === Math.min(levels.length - 1, s.levelIndex) ? 'on' : undefined}
            onClick={act(() => s.setLevelIndex(i))}
            aria-pressed={i === s.levelIndex}
          >
            {levels[i] < 10 ? levels[i].toFixed(1) : levels[i].toFixed(0)} m
          </button>
        ))}
      </div>
    </div>
  )
}
