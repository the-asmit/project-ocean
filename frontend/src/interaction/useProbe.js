import { useVisualizationState } from '../state/useVisualizationState.js'
import { blockLayout } from '../scene/blockLayout.js'
import { depthAxis, makeSeafloorAt } from '../charts/sampling.js'

// The depth cursor: one derived object describing where the probe currently
// sits in the pinned column, shared by the 3D marker, the info panel and the
// profile chart so all three can never disagree about which level is being read.
//
// It deliberately does NOT mutate `selected`. The pin is the anchor — the click
// that produced it, its server verification, and its own depth — and the cursor
// travels independently down that column. Folding the two together would refire
// the /point query on every step of the slider.

export function probeLevels(dataset) {
  return depthAxis(dataset)
}

// Index of the model level closest to a depth in metres.
export function nearestLevel(dataset, depthM) {
  const levels = probeLevels(dataset)
  let best = 0, bestD = Infinity
  for (let i = 0; i < levels.length; i++) {
    const d = Math.abs(levels[i] - depthM)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

export function useProbe(dataset) {
  const selected = useVisualizationState((s) => s.selected)
  const probeIndex = useVisualizationState((s) => s.probeIndex)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const depthClip = useVisualizationState((s) => s.depthClip)
  if (!selected) return null

  const { map, sampler } = dataset
  const levels = probeLevels(dataset)
  const i = Math.min(levels.length - 1, Math.max(0, probeIndex ?? 0))
  const depthM = levels[i]

  const x = map.lonToX(selected.lon)
  const z = map.latToZ(selected.lat)
  const s = sampler(x, map.depthToY(depthM), z)

  const floorM = makeSeafloorAt(dataset)(x, z)
  const L = blockLayout(dataset, vertExag, depthClip)

  return {
    lat: selected.lat,
    lon: selected.lon,
    level: i + 1,
    index: i,
    levels,
    levelCount: levels.length,
    depthM,
    value: s.value,
    valid: s.valid,
    seafloorM: Number.isFinite(floorM) ? floorM : null,
    belowSeafloor: Number.isFinite(floorM) && depthM > floorM,
    x, z,
    world: [x, L.yOfDepthM(depthM), z],
    yOfDepthM: L.yOfDepthM,
  }
}
