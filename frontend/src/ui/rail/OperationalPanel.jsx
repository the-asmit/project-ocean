import { IsosurfaceControl } from '../SectionControls.jsx'
import { Layer } from '../DataLayersPanel.jsx'

// Derived, decision-relevant quantities — the operational layer from
// OPERATIONAL_LAYER_SPEC.md.
//
// THREE OF THESE FOUR ARE SEATED, NOT BUILT. Their computations land in a later
// math-only pass, and putting their toggles in their final home now means that
// pass does not have to touch layout again. They use the SAME `Layer` row as the
// CTD and drifter stubs in the FIELD panel, disabled and badged SOON — the
// convention is reused rather than re-implemented, so the two cannot drift.
//
// A disabled row here is a promise about the interface, not about the data. It
// says "this quantity belongs here and is not computed yet", which is a
// different claim from SOON on an observation layer ("no feed connected"), and
// the tooltips say which.
const STUBS = [
  {
    key: 'tchp',
    name: 'Cyclone heat potential',
    title: 'D26 (depth of the 26 °C isotherm) and the heat integrated above it, '
      + 'with the ~40 kJ/cm² cyclone-intensification contour. '
      + 'Not yet computed — the toggle is seated, the math lands in a later pass.',
  },
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

export default function OperationalPanel({ dataset, compact }) {
  return (
    <>
      <div className="field">
        <span className="lbl">Derived quantities</span>
        <div className="layers">
          {STUBS.map((s) => (
            <Layer key={s.key} disabled badge="SOON" title={s.title}>
              {s.name}
            </Layer>
          ))}
        </div>
        <p className="hint" style={{ margin: '9px 0 0' }}>
          Computed from the GLORYS volume already loaded — no new data. Seated here
          now so the interface does not move when the math lands.
        </p>
      </div>

      {/* The one live member of the group, moved here from SECTION: it is a
          derived quantity, not a cut through the block. */}
      <IsosurfaceControl dataset={dataset} compact={compact} />
    </>
  )
}
