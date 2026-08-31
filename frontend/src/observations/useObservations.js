import { useEffect, useMemo, useState } from 'react'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { mockArgoSource } from './ObservationSource.js'
import { sampleProfile } from '../charts/sampling.js'

// One place that owns "which floats exist" and "what does the selected one
// read", so the scene markers, the picker and the chart all see the same list.
//
// The source is constructed per dataset because a float list is only meaningful
// inside a loaded tile. Swapping mockArgoSource for a real adapter is the only
// change needed here.

export function useObservationSource(dataset) {
  return useMemo(() => mockArgoSource(dataset), [dataset])
}

export function useFloats(dataset) {
  const source = useObservationSource(dataset)
  const [floats, setFloats] = useState([])
  useEffect(() => {
    let dead = false
    source.listFloats().then((f) => { if (!dead) setFloats(f) })
    return () => { dead = true }
  }, [source])
  return floats
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
