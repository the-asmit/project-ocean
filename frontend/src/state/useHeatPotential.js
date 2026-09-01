import { useMemo } from 'react'
import {
  computeHeatPotential, heatPotentialAvailable,
} from '../scene/heatPotential.js'

// ONE computation per tile, shared by everything that reads it.
//
// The 3-D sheets, the threshold contour, the cursor card and the pinned stat
// cards all want the same two grids. Computing them per consumer would be three
// or four passes over the volume and — worse — would let two readouts drift if
// one of them ever changed a constant. A WeakMap keyed on the dataset OBJECT
// means the result dies with the tile it describes, with no invalidation to get
// wrong: a new tile is a new object, so it gets a new computation by
// construction.
//
// Keyed on the dataset rather than region+date+variable on purpose. Those three
// strings identify a request; the dataset object identifies the bytes that came
// back, and it is the bytes this is arithmetic on.

const CACHE = new WeakMap()

export function heatPotentialFor(dataset) {
  if (!dataset || !heatPotentialAvailable(dataset)) return null
  let h = CACHE.get(dataset)
  if (!h) {
    h = computeHeatPotential(dataset)
    CACHE.set(dataset, h)
    if (import.meta.env.DEV) window.__oceanHeat = h
  }
  return h
}

export function useHeatPotential(dataset) {
  return useMemo(() => heatPotentialFor(dataset), [dataset])
}
