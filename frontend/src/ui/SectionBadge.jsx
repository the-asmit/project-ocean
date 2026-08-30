import { useMemo } from 'react'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { sliceStops, stopAt } from '../scene/sliceStops.js'

// What the cut top face IS, stated on the canvas itself.
//
// Unsliced, the top face is stylized shading and the footer says so. The moment
// the block is sliced that face becomes a real horizontal section through the
// GLORYS volume, and a screenshot of it has to carry its own provenance and its
// own depth — otherwise the most quotable image the tool produces is the one
// with the least context attached to it (P3).
export default function SectionBadge({ dataset }) {
  const clipIndex = useVisualizationState((s) => s.clipIndex)
  const sliceExtended = useVisualizationState((s) => s.sliceExtended)
  const stops = useMemo(
    () => sliceStops(dataset, sliceExtended),
    [dataset, sliceExtended],
  )
  const stop = stopAt(stops, clipIndex)
  if (!stop) return null

  const v = dataset.meta.volume
  return (
    <div className={`section-badge${stop.real ? '' : ' void'}`}>
      <div className="t">Horizontal section</div>
      <div className="d">{stop.depthM.toFixed(stop.real ? 1 : 0)} m</div>
      {stop.real ? (
        <div className="s">
          model level {stop.level} of {stops.filter((x) => x.real).length}
          <br />real {v.source} {v.variable}
        </div>
      ) : (
        <div className="s">
          below the {v.maxDepthM.toFixed(0)} m extent of {v.variable}
          <br />no value at this depth
        </div>
      )}
    </div>
  )
}
