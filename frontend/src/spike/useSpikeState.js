import { useEffect } from 'react'
import { create } from 'zustand'
import { FRAMES } from './syntheticCurrents.js'

// SPIKE state, deliberately in its OWN store.
//
// Keeping it out of useVisualizationState is the isolation guarantee: no
// component in §5.1-§5.5 subscribes to this store, so playing the animation
// cannot re-render the block, rebuild the isosurface, or refire the /point
// query. Nothing here is ever passed to loadDataset — the real date, region
// and variable are untouched.

const FPS = 6

export const useSpikeState = create((set, get) => ({
  showCurrents: false,       // off by default: it is fabricated data
  frame: 0,
  playing: false,
  levelIndex: 0,             // index into SPIKE_LEVELS

  setShowCurrents: (showCurrents) =>
    set(showCurrents ? { showCurrents } : { showCurrents, playing: false }),
  setLevelIndex: (levelIndex) => set({ levelIndex }),
  setFrame: (frame) => set({ frame: ((frame % FRAMES) + FRAMES) % FRAMES }),
  step: (d) => get().setFrame(get().frame + d),
  setPlaying: (playing) => set({ playing }),
  togglePlay: () => set({ playing: !get().playing }),
}))

// The play loop. Mounted once, by the timeline strip. An interval rather than
// useFrame: the point is a fixed step rate the eye can follow, not one tied to
// the render loop's speed.
export function usePlayLoop() {
  const playing = useSpikeState((s) => s.playing)
  const showCurrents = useSpikeState((s) => s.showCurrents)
  useEffect(() => {
    if (!playing || !showCurrents) return undefined
    const id = setInterval(() => useSpikeState.getState().step(1), 1000 / FPS)
    return () => clearInterval(id)
  }, [playing, showCurrents])
}
