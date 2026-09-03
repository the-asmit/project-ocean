import { useMemo } from 'react'
import opsSpec from '../../../OPERATIONAL_LAYER_SPEC.md?raw'
import { renderMarkdown, section } from './markdown.js'

// What this tool is for, what it does today, and what it deliberately does not
// do. Every status below was checked against the implementation, not against a
// plan — the two disagree in places and this page reports the implementation.
//
// The "planned extensions" block is NOT paraphrased: it is spliced live out of
// OPERATIONAL_LAYER_SPEC.md §8 so the page cannot drift from the spec. §8 also
// records why naming them matters — the PS explicitly rewards an extensible
// plugin architecture, and naming the excluded work satisfies that without
// building research-grade features.

// SIH 26067's five stated gaps, verbatim from INTERACTION_LAYER_SPEC.md §1,
// with what the build actually does about each.
const GAPS = [
  {
    n: 1,
    gap: 'No web-based 3D depth-resolved volumetric views of model fields.',
    state: 'live',
    detail: 'Real GLORYS12V1 rendered as a bounded 3-D block. Cut faces are real vertical '
      + 'cross-sections on the model’s own 31 non-uniform levels; the top face becomes a real '
      + 'horizontal section once sliced. Marching-tetrahedra isosurfaces extract the 3-D shape '
      + 'of any value.',
  },
  {
    n: 2,
    gap: 'No unified display of Argo/Glider/CTD profiles ALONGSIDE model fields.',
    state: 'partial',
    detail: 'Argo and gliders are live from the Ifremer ERDDAP GDACs, drawn in the same scene '
      + 'as the model and compared on shared axes with a mean |Δ| and a worst-disagreement '
      + 'depth. CTD stations and drifters have no feed connected and are badged SOON in the UI.',
  },
  {
    n: 3,
    gap: 'No interactive controls for variable selection, depth-slice navigation, time-step '
      + 'animation, colorbars.',
    state: 'partial',
    detail: 'Variable switching, depth and west slices snapped to real model levels and columns, '
      + 'and a full colorbar editor (4 palettes, custom range, log/linear) are live. Time-step '
      + 'animation exists for currents only — eight consecutive GLORYS days; the scalar field is '
      + 'a single day with no date picker.',
  },
  {
    n: 4,
    gap: 'No extensible ingestion of new variables/sensors.',
    state: 'partial',
    detail: 'The seam is real and was proven, not asserted: swapping the Argo mock for the real '
      + 'GDAC adapter changed one line, because every consumer reads the ObservationSource '
      + 'contract. Variables are a declarative table in the GLORYS adapter. There is no plugin '
      + 'registry or dynamic loading.',
  },
  {
    n: 5,
    gap: 'No tools for intuitive, rapid understanding of complex 3D phenomena.',
    state: 'partial',
    detail: 'Slicing, probing, the depth cursor, isosurfaces and animated streamlines are live, '
      + 'and so is the flagship decision quantity: cyclone heat potential with the depth of the '
      + '26 °C isotherm, drawn as a warped surface with the ~40 kJ/cm² intensification '
      + 'contour on it. Thermocline depth, drift and anomaly are specified and seated in the '
      + 'interface, but their computations are not yet wired.',
  },
]

// OPERATIONAL_LAYER_SPEC.md §9's build order, against what exists.
const OPS = [
  { n: 1, name: 'D26 + TCHP', state: 'live',
    note: 'Shipped. Depth of the 26 °C isotherm as a warped surface inside the block, the '
      + 'heat integral above it as a field on top, and the ~40 kJ/cm² contour drawn on both. '
      + 'Computed in the browser from the loaded volume in 5-10 ms — no new fetch — and '
      + 'verified against an independent Python implementation over the source NetCDF, which it '
      + 'matches exactly on every statistic.' },
  { n: 2, name: 'Anomaly view', state: 'planned',
    note: 'Value minus the tile’s own mean at that depth, on a diverging ramp. Seated as the '
      + 'Normal/Anomaly control in the SCALE rail, disabled.' },
  { n: 3, name: 'Model-vs-Argo profile overlay', state: 'live',
    note: 'Shipped, and against REAL Argo rather than the mock the spec assumed. Two curves on '
      + 'one axis, with mean |Δ|, the worst-disagreement depth, the float’s DAC and data mode, '
      + 'and an explicit warning when the profile date differs from the model date.' },
  { n: 4, name: 'Thermocline-depth surface', state: 'planned',
    note: 'Depth of maximum |dT/dz| per column, rendered as a warped surface. Toggle seated, '
      + 'compute not wired.' },
  { n: 5, name: 'Drift trajectory', state: 'planned',
    note: 'Forward particle advection through the measured uo/vo field — the existing RK2 '
      + 'streamline tracer applied to one seeded point. Toggle seated, compute not wired.' },
  { n: 6, name: 'Isosurface with isovalue slider', state: 'live',
    note: 'Shipped, and the spec’s §6 trap was avoided: extraction uses a standalone '
      + 'marching-TETRAHEDRA function over the scalar array, never three.js’s metaball '
      + 'MarchingCubes addon. Verified at 28,064 triangles in ~58 ms on the demo tile.' },
]

const STATE_LABEL = { live: 'LIVE', partial: 'PARTIAL', planned: 'PLANNED' }

function Tag({ state }) {
  return <span className={`badge tag-${state}`}>{STATE_LABEL[state]}</span>
}

export default function RoadmapPage() {
  const extensions = useMemo(
    () => renderMarkdown(section(opsSpec, '## 8.'), 6),
    [],
  )

  return (
    <div className="page-body roadmap">
      <div className="rm-inner">
        <header className="rm-head">
          <h1>Ocean-Viz — scope and roadmap</h1>
          <p className="rm-lede">
            Built for <b>Smart India Hackathon PS 26067</b> (INCOIS / Ministry of Earth Sciences).
            What the problem statement asks for, what this build does about it today, and what is
            deliberately excluded. Statuses were checked against the implementation.
          </p>
        </header>

        <section className="rm-sec">
          <h2>The problem statement’s five stated gaps</h2>
          <p className="rm-note">
            Quoted from <code>INTERACTION_LAYER_SPEC.md</code> §1. Gap 2 — co-visualising
            observations alongside the model — is named there as the headline differentiator.
          </p>
          <div className="rm-list">
            {GAPS.map((g) => (
              <article key={g.n} className="rm-item">
                <div className="rm-item-head">
                  <span className="rm-n">{g.n}</span>
                  <h3>{g.gap}</h3>
                  <Tag state={g.state} />
                </div>
                <p>{g.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rm-sec">
          <h2>How it is built</h2>
          <div className="rm-arch">
            <div className="rm-card">
              <span className="lbl">Backend</span>
              <p>
                FastAPI + <code>copernicusmarine</code> + xarray. Subsets GLORYS12V1 and its static
                bathymetry, derives an RG8 volume texture (R = value, G = validity) plus a 128-entry
                depth LUT, and caches every product on disk by region + date + variable. Also proxies
                the Argo and OceanGliders GDACs, which send no CORS headers.
              </p>
            </div>
            <div className="rm-card">
              <span className="lbl">Frontend</span>
              <p>
                React + three.js. One GLSL3 shader draws the block; a CPU sampler walks the
                <em> same bytes</em> so a hovered number is the number being rendered. Marching
                tetrahedra, RK2 streamlines and the chart samplers all read that one dataset object.
              </p>
            </div>
            <div className="rm-card">
              <span className="lbl">Discipline</span>
              <p>
                One function per concern — one colour definition, one vertical mapping, one sampler.
                Anything not measured says so on screen: REAL, DERIVED, STYLIZED, SOON. An empty
                instrument layer is rendered as an empty layer, never quietly replaced by a mock.
              </p>
            </div>
          </div>
          <p className="rm-note">
            Full detail, including the audit of dead code and documentation contradictions, is on the{' '}
            <a href="#/docs">Docs</a> page.
          </p>
        </section>

        <section className="rm-sec">
          <h2>Operational layer — build order and status</h2>
          <p className="rm-note">
            From <code>OPERATIONAL_LAYER_SPEC.md</code> §9. Two of the six are already shipped. The
            remaining four have their toggles seated in the interface now, disabled and badged, so
            the later math-only passes do not have to touch layout again.
          </p>
          <div className="rm-list">
            {OPS.map((o) => (
              <article key={o.n} className="rm-item">
                <div className="rm-item-head">
                  <span className="rm-n">{o.n}</span>
                  <h3>{o.name}</h3>
                  <Tag state={o.state} />
                </div>
                <p>{o.note}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rm-sec">
          <h2>Planned extensions — explicitly out of scope</h2>
          <p className="rm-note">
            Spliced live out of <code>OPERATIONAL_LAYER_SPEC.md</code> §8, so this page cannot drift
            from the spec. These are named rather than built on purpose: each is a research-grade
            problem whose cost is not repaid at this scale.
          </p>
          <div
            className="rm-md"
            dangerouslySetInnerHTML={{ __html: extensions }}
          />
        </section>
      </div>
    </div>
  )
}
