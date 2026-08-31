import { useSpikeState, usePlayLoop } from '../spike/useSpikeState.js'
import { FRAMES, frameLabel, SPIKE_LEVELS } from '../spike/syntheticCurrents.js'
import { IconPlay, IconPause, IconPrev, IconNext } from './icons.jsx'

// SPIKE — the time scrubber for the synthetic current field.
//
// Sits under the 3D view because that is the only thing it drives. It does NOT
// touch the real date: the app bar still reads 2020-01-01 and the GLORYS fetch
// never sees a frame index. Labels are RELATIVE offsets for the same reason —
// a fabricated date printed beside a real one is the single most misleading
// thing this strip could do.

export default function TimelineControls() {
  usePlayLoop()
  const s = useSpikeState()
  if (!s.showCurrents) return null

  return (
    <div className="timeline">
      <span className="tl-tag">SYNTHETIC</span>

      <div className="tl-transport">
        <button type="button" onClick={() => s.step(-1)} title="Previous frame">
          <IconPrev size={11} />
        </button>
        <button
          type="button" className={s.playing ? 'on' : undefined}
          onClick={s.togglePlay}
          title={s.playing ? 'Pause' : 'Play'}
          aria-pressed={s.playing}
        >
          {s.playing ? <IconPause size={11} /> : <IconPlay size={11} />}
        </button>
        <button type="button" onClick={() => s.step(1)} title="Next frame">
          <IconNext size={11} />
        </button>
      </div>

      <input
        className="tl-scrub" type="range" min={0} max={FRAMES - 1} step={1}
        value={s.frame} onChange={(e) => s.setFrame(parseInt(e.target.value, 10))}
        aria-label="Synthetic time frame"
      />

      <span className="tl-clock">{frameLabel(s.frame)}</span>
      <span className="tl-count">{s.frame + 1}/{FRAMES}</span>

      <div className="tl-levels">
        {SPIKE_LEVELS.map((l, i) => (
          <button
            key={l.depthM} type="button"
            className={i === s.levelIndex ? 'on' : undefined}
            onClick={() => s.setLevelIndex(i)}
            aria-pressed={i === s.levelIndex}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  )
}
