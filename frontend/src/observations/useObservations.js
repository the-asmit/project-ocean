import { useEffect, useMemo, useState } from 'react'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { argoSource } from './argoSource.js'
import { gliderSource } from './gliderSource.js'
import { sampleProfile } from '../charts/sampling.js'

// One place that owns "which floats exist" and "what does the selected one
// read", so the scene markers, the picker and the chart all see the same list.
//
// The source is constructed per dataset because a float list is only meaningful
// inside a loaded tile. mockArgoSource lived here until real GDAC data replaced
// it; the swap was one line, which is what the interface was for.
// ObservationSource.js keeps the mock for offline work, unreferenced.

export function useObservationSource(dataset) {
  return useMemo(() => argoSource(dataset), [dataset])
}

// Real sources can be empty, slow or down, and each of those is a different
// thing to tell the user. `status` is what the layers render from.
//   'loading' | 'ready' | 'empty' | 'error'
export function useFloats(dataset) {
  const source = useObservationSource(dataset)
  const [floats, setFloats] = useState([])
  useEffect(() => {
    let dead = false
    setFloats([])
    source.listFloats().then((f) => { if (!dead) setFloats(f) }).catch(() => {})
    return () => { dead = true }
  }, [source])
  return floats
}

// The float list plus everything needed to explain it: how many, over what
// window, from where, and whether the answer is "none here".
export function useArgoState(dataset) {
  const source = useObservationSource(dataset)
  const [state, setState] = useState({ status: 'loading', floats: [], meta: null })
  useEffect(() => {
    let dead = false
    setState({ status: 'loading', floats: [], meta: null })
    Promise.all([source.listFloats(), source.meta()])
      .then(([floats, meta]) => {
        if (dead) return
        setState({ status: floats.length ? 'ready' : 'empty', floats, meta })
      })
      .catch((e) => { if (!dead) setState({ status: 'error', floats: [], meta: null, error: String(e) }) })
    return () => { dead = true }
  }, [source])
  return state
}

// --- gliders --------------------------------------------------------------
// Deliberately separate from the float list: a track is a path, not a station.
export function useGliderSource(dataset) {
  return useMemo(() => gliderSource(dataset), [dataset])
}

export function useGliderTracks(dataset) {
  const source = useGliderSource(dataset)
  const [state, setState] = useState({ status: 'loading', tracks: [], meta: null })
  useEffect(() => {
    let dead = false
    setState({ status: 'loading', tracks: [], meta: null })
    source.listTracks()
      .then((r) => {
        if (dead) return
        setState({
          status: r.count ? 'ready' : 'empty',
          tracks: r.tracks,
          meta: { windowFrom: r.windowFrom, windowTo: r.windowTo, windowDays: r.windowDays,
                  source: r.source, sourceUrl: r.sourceUrl, modelDate: r.date },
        })
      })
      .catch((e) => { if (!dead) setState({ status: 'error', tracks: [], meta: null, error: String(e) }) })
    return () => { dead = true }
  }, [source])
  return state
}

// One deployment's decimated path. Held per selected id, not per component, so
// two consumers cannot start two 4,000-point fetches of the same track.
export function useGliderTrack(dataset, deployment) {
  const source = useGliderSource(dataset)
  const [state, setState] = useState({ status: 'idle', track: null })
  useEffect(() => {
    let dead = false
    if (!deployment) { setState({ status: 'idle', track: null }); return undefined }
    setState({ status: 'loading', track: null })
    source.getTrack(deployment)
      .then((t) => { if (!dead) setState({ status: t.points?.length ? 'ready' : 'empty', track: t }) })
      .catch((e) => { if (!dead) setState({ status: 'error', track: null, error: String(e) }) })
    return () => { dead = true }
  }, [source, deployment])
  return state
}

// The selected float's observed profile, and the MODEL column at the same
// position — the comparison the PS actually asks for. Both are resampled onto
// the observation's own depths, because that is the series with real levels;
// interpolating the model onto them is the honest direction.
export function useComparison(dataset) {
  const source = useObservationSource(dataset)
  const floats = useFloats(dataset)
  const selectedFloatId = useVisualizationState((s) => s.selectedFloatId)
  const [obs, setObs] = useState(null)

  useEffect(() => {
    let dead = false
    if (!selectedFloatId) { setObs(null); return undefined }
    source.getProfile(selectedFloatId).then((o) => { if (!dead) setObs(o) })
    return () => { dead = true }
  }, [source, selectedFloatId])

  const float = floats.find((f) => f.id === selectedFloatId) || null

  return useMemo(() => {
    if (!float || !obs || !obs.levels.length) return null
    const model = sampleProfile(dataset, float.lat, float.lon)
    if (model.length < 2) return null

    // linear interpolation of the model column onto an observation depth
    const modelAt = (d) => {
      if (d <= model[0].depth) return model[0].value
      for (let i = 0; i < model.length - 1; i++) {
        const a = model[i], b = model[i + 1]
        if (d >= a.depth && d <= b.depth) {
          const t = (d - a.depth) / (b.depth - a.depth || 1)
          return a.value + t * (b.value - a.value)
        }
      }
      return null
    }

    const rows = []
    let sumAbs = 0, n = 0, worst = { diff: 0, depthM: null }
    for (const lv of obs.levels) {
      const m = modelAt(lv.depthM)
      const diff = m == null ? null : lv.value - m
      if (diff != null) {
        sumAbs += Math.abs(diff)
        n++
        if (Math.abs(diff) > Math.abs(worst.diff)) worst = { diff, depthM: lv.depthM }
      }
      rows.push({ depth: lv.depthM, obs: lv.value, model: m, diff })
    }
    return {
      float,
      obs,
      rows,
      meanAbsDiff: n ? sumAbs / n : null,
      worst: worst.depthM == null ? null : worst,
      synthetic: obs.synthetic,
    }
  }, [dataset, float, obs])
}
