import { useEffect } from 'react'
import { create } from 'zustand'
import { loadCurrents } from './currentsData.js'

// Currents live in their OWN store, separate from useVisualizationState.
//
// That was the isolation guarantee during the spike and it still holds: no
// component in §5.1-§5.5 subscribes here, so stepping frames cannot re-render
// the block, rebuild the isosurface, or refire the /point query. The frame
// index is a currents-only concept and never reaches loadDataset.
//
// THE LOADED FIELD LIVES IN THE STORE, not in a hook's useState. Four
// components read it (the scene layer, the strip, the chip, the footer), and
// per-component state meant four independent loaders fetching 10.6 MB each —
// and worse, the effect that set `loading` re-ran itself and its own cleanup
// cancelled the in-flight request, so the load never completed at all.

// One GLORYS day per frame. At 6 fps eight days went by in 1.3 s, too fast to
// read a day; 3 fps gives each frame a third of a second.
const FPS = 3

export const useCurrentsState = create((set, get) => ({
  showCurrents: false,
  frame: 0,
  playing: false,
  levelIndex: 0,

  data: { status: 'idle' },
  dataKey: null,

  setShowCurrents: (showCurrents) =>
    set(showCurrents ? { showCurrents } : { showCurrents, playing: false }),
  setLevelIndex: (levelIndex) => set({ levelIndex }),
  setFrame: (frame, n) => set({ frame: n ? ((frame % n) + n) % n : 0 }),
  step: (d, n) => get().setFrame(get().frame + d, n),
  setPlaying: (playing) => set({ playing }),
  togglePlay: () => set({ playing: !get().playing }),

  // Loads the manifest and every frame once per region+date. Eight frames is
  // 10.6 MB from localhost — loading them all up front means playback never
  // stalls mid-loop waiting on a fetch.
  load: async (region, date) => {
    const key = `${region}|${date}`
    if (get().dataKey === key) return           // already loading or loaded
    set({ dataKey: key, data: { status: 'loading' }, frame: 0, playing: false })
    try {
      const d = await loadCurrents(region, date)
      if (get().dataKey !== key) return         // a newer tile won the race
      set({ data: { status: 'ready', ...d } })
    } catch (e) {
      if (get().dataKey !== key) return
      set({ data: { status: 'error', error: String(e) } })
    }
  },
}))

export function useCurrentsData(dataset) {
  const show = useCurrentsState((s) => s.showCurrents)
  const data = useCurrentsState((s) => s.data)
  const dataKey = useCurrentsState((s) => s.dataKey)
  const load = useCurrentsState((s) => s.load)
  const region = dataset.meta.region
  const date = dataset.meta.date
  const key = `${region}|${date}`

  useEffect(() => {
    if (show && dataKey !== key) load(region, date)
  }, [show, dataKey, key, region, date, load])

  return data
}

export function usePlayLoop(frameCount) {
  const playing = useCurrentsState((s) => s.playing)
  const show = useCurrentsState((s) => s.showCurrents)
  useEffect(() => {
    if (!playing || !show || !frameCount) return undefined
    const id = setInterval(
      () => useCurrentsState.getState().step(1, frameCount), 1000 / FPS,
    )
    return () => clearInterval(id)
  }, [playing, show, frameCount])
}
