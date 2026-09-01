import { useMemo } from 'react'
import { useVisualizationState } from './useVisualizationState.js'
import { makeScale } from '../scene/colorScale.js'

// One hook, one scale. Every consumer that turns a value into a colour — the
// block shader's LUT, the isosurface, the glider ribbon, the section isolines,
// the profile knots, the isovalue swatch and the colorbar itself — reads THIS,
// so a palette or range change moves all of them together or none of them.
export function useColorScale(dataset) {
  const paletteId = useVisualizationState((s) => s.palette)
  const log = useVisualizationState((s) => s.logScale)
  const customRange = useVisualizationState((s) => s.customRange)
  const v = dataset?.meta?.volume
  return useMemo(
    () => makeScale({
      paletteId,
      valueMin: v?.valueMin ?? 0,
      valueMax: v?.valueMax ?? 1,
      range: customRange,
      log,
    }),
    [paletteId, log, customRange, v?.valueMin, v?.valueMax],
  )
}
