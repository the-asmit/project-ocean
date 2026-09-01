import { IsosurfaceControl } from '../SectionControls.jsx'
import { Layer } from '../DataLayersPanel.jsx'
import { useVisualizationState } from '../../state/useVisualizationState.js'
import { useHeatPotential } from '../../state/useHeatPotential.js'
import { heatPotentialAvailable, THRESHOLD, TCHP_MAX } from '../../scene/heatPotential.js'
import { paletteRGB } from '../../scene/colorScale.js'

// Derived, decision-relevant quantities — the operational layer from
// OPERATIONAL_LAYER_SPEC.md.
//
// Cyclone heat potential is LIVE (§3, the flagship). The other two are seated,
// not built: their computations land in a later pass, and putting their toggles
// in their final home now means that pass does not have to touch layout again.
// They use the SAME `Layer` row as the CTD and drifter stubs in the FIELD
// panel, disabled and badged SOON — the convention is reused rather than
// re-implemented, so the two cannot drift.
//
// A disabled row here is a promise about the interface, not about the data. It
// says "this quantity belongs here and is not computed yet", which is a
// different claim from SOON on an observation layer ("no feed connected"), and
// the tooltips say which.
const STUBS = [
  {
    key: 'thermocline',
    name: 'Thermocline depth',
    title: 'Depth of the maximum vertical temperature gradient per column, drawn as a '
      + 'warped surface inside the block. Not yet computed.',
  },
  {
    key: 'drift',
    name: 'Drift trajectory',
    title: 'Forward particle advection through the measured uo/vo field — the same RK2 '
      + 'tracer the streamlines already use, applied to one seeded point. Not yet computed.',
  },
]

const n0 = (x) => Math.round(x).toLocaleString()

function HeatControl({ dataset, compact }) {
  const showHeat = useVisualizationState((s) => s.showHeat)
  const setShowHeat = useVisualizationState((s) => s.setShowHeat)
  const heatD26 = useVisualizationState((s) => s.heatD26)
  const setHeatD26 = useVisualizationState((s) => s.setHeatD26)
  const heatField = useVisualizationState((s) => s.heatField)
  const setHeatField = useVisualizationState((s) => s.setHeatField)
  const paletteId = useVisualizationState((s) => s.palette)
  const clipIndex = useVisualizationState((s) => s.clipIndex)
  const setVariable = useVisualizationState((s) => s.setVariable)
  const heat = useHeatPotential(dataset)

  // One variable is loaded at a time and this is arithmetic on the temperature
  // volume. Fetching thetao behind the user's back to satisfy a toggle would
  // make a layer switch a data load, silently, which is exactly the kind of
  // hidden round-trip the rest of this build refuses.
  const available = heatPotentialAvailable(dataset)
  const st = heat?.stats
  const [r, g, b] = paletteRGB(paletteId, THRESHOLD / TCHP_MAX)

  return (
    <div className="field">
      <span className="lbl">Derived quantities</span>
      <div className="layers">
        <Layer
          on={showHeat && available}
          disabled={!available}
          swatch={`rgb(${r},${g},${b})`}
          badge="DERIVED"
          onClick={() => setShowHeat(!showHeat)}
          title={available
            ? 'D26 (depth of the 26 °C isotherm) as a warped surface inside the block, '
              + 'and the heat integrated above it as a field on top, with the ~40 kJ/cm² '
              + 'cyclone-intensification contour on both. Computed here, from the volume '
              + 'already loaded — no new data.'
            : 'Needs the temperature volume. This is an integral of (T − 26 °C) over '
              + 'depth; the loaded volume is salinity.'}
        >
          Cyclone heat potential
        </Layer>
        {STUBS.map((s) => (
          <Layer key={s.key} disabled badge="SOON" title={s.title}>
            {s.name}
          </Layer>
        ))}
      </div>

      {!available && (
        <p className="hint" style={{ margin: '9px 0 0' }}>
          Not available on {dataset.meta.volume.variableLabel.toLowerCase()} — TCHP is
          the depth integral of (T − 26 °C), so it needs the temperature volume.{' '}
          <button type="button" className="linkish" onClick={() => setVariable('thetao')}>
            Load temperature
          </button>
        </p>
      )}

      {showHeat && available && (
        <>
          <div className="layers sub">
            <Layer
              on={heatD26} onClick={() => setHeatD26(!heatD26)}
              title="The 26 °C isotherm as a sheet inside the block — it dips into warm pools and rises where the warm layer is thin. Slice the top down past it to lift it into open air."
            >
              D26 surface
            </Layer>
            <Layer
              on={heatField && clipIndex === 0} onClick={() => setHeatField(!heatField)}
              title={clipIndex > 0
                ? 'Stood down while the block is sliced — the top face is the real horizontal section then, and this would hover over it.'
                : "Heat content above D26, drawn on the block's top face."}
            >
              TCHP field
            </Layer>
          </div>

          {heatD26 && clipIndex === 0 && st?.d26Min != null && (
            <p className="hint" style={{ margin: '7px 0 0' }}>
              The D26 sheet is <b>inside</b> the block — it shows through faintly where the
              block is in front of it. Drag the top slice down past about{' '}
              {Math.round(st.d26Min / 10) * 10}–{Math.round(st.d26Max / 10) * 10} m in
              SECTION to lift it into open air.
            </p>
          )}

          {heatField && clipIndex > 0 && (
            <p className="hint" style={{ margin: '7px 0 0' }}>
              The TCHP field is stood down while the block is sliced: the top face is
              the real horizontal section now, and a sheet at depth 0 would hover over
              the very cut you made to see it. The number is still on the cursor and the
              pinned cards — it was computed, not drawn.
            </p>
          )}

          {st && (
            <p className="hint" style={{ margin: '9px 0 0' }}>
              {n0(st.water)} water columns · <b>{(st.overFraction * 100).toFixed(0)}%
              over {THRESHOLD} kJ/cm²</b> · D26 {st.d26Min?.toFixed(0)}–{st.d26Max?.toFixed(0)} m
              · TCHP {st.tchpMin?.toFixed(0)}–{st.tchpMax?.toFixed(0)} kJ/cm², from the
              model&apos;s own {dataset.meta.volume.levelsReal} levels in {heat.ms.toFixed(0)} ms.
              {st.cold > 0 && ` ${n0(st.cold)} columns have no warm layer at all.`}
            </p>
          )}

          {st?.censored > 0 && (
            <p className="hint" style={{ margin: '7px 0 0' }}>
              {n0(st.censored)} columns are warmer than 26 °C all the way to the
              seafloor or to the volume&apos;s {dataset.meta.volume.maxDepthM.toFixed(0)} m
              extent. Their D26 is a lower bound and is reported as <b>≥ d</b>, never as
              a bare number.
            </p>
          )}

          {!compact && (
            <>
              <p className="hint" style={{ margin: '7px 0 0' }}>
                ρ = {1026} kg/m³, c_p = {3990} J/(kg·°C) — the standard constants for the
                direct depth-integral method. The absolute kJ/cm² is a physically-grounded
                estimate, not a match to a specific INCOIS product to the decimal; the
                spatial pattern and which side of the line a column falls on are the robust
                claims. ~{THRESHOLD} kJ/cm² is the commonly-cited Bay of Bengal figure —
                confirm the source before quoting it.
              </p>
              <p className="hint" style={{ margin: '7px 0 0' }}>
                Read off the 8-bit volume, where one code is 0.098 °C. Measured against the
                float64 source: TCHP off by 0.26 kJ/cm² on average, 1.36 worst, and one
                column in 4,049 changes side of the threshold. D26 is sub-metre except on
                near-isothermal columns, where dT/dz approaches zero, the crossing is
                ill-conditioned and the worst case measured was 7.8 m.
              </p>
            </>
          )}
        </>
      )}

      {!showHeat && (
        <p className="hint" style={{ margin: '9px 0 0' }}>
          Computed from the GLORYS volume already loaded — no new data. Seated here
          now so the interface does not move when the rest of the math lands.
        </p>
      )}
    </div>
  )
}

export default function OperationalPanel({ dataset, compact }) {
  return (
    <>
      <HeatControl dataset={dataset} compact={compact} />

      {/* The other live member of the group, moved here from SECTION: it is a
          derived quantity, not a cut through the block. */}
      <IsosurfaceControl dataset={dataset} compact={compact} />
    </>
  )
}
