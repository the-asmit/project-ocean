# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: ocean scientists and analysts (INCOIS and equivalent institutions)** who
need to interrogate a 4-D ocean model field — read an actual value at an actual
lat/lon/depth, see where the thermocline sits, understand where the data ends and
the seafloor begins. Precision and provenance are non-negotiable for them.

**Secondary, and a hard constraint on the primary: non-specialist evaluators.** The
same build must be legible inside a ~10-minute Smart India Hackathon demo to judges
who have never seen the dataset. This is not a separate "presentation mode" — one
interface serves both. When the two pull apart, the expert reading wins on
*correctness* and the demo reading wins on *first impression*: nothing may be
simplified into being wrong, and nothing correct may be left unexplained.

Not in scope as a designed-for audience: classroom/public outreach. Comprehensibility
is a means to the demo constraint here, not an outreach product goal.

## Product Purpose

Ocean-Viz turns Copernicus Marine GLORYS12V1 model output into a space you fly
through rather than a map you page through. A user enters the water column, sees the
scalar field as a continuous volumetric gradient bounded by real bathymetry, and
interrogates any point in it.

Success: a user who could previously only read the ocean as stacked 2-D depth slices
can perceive vertical structure — thermocline, shelf break, water-mass boundaries —
directly, and can still extract the exact number underneath what they are looking at.

Built for **Smart India Hackathon PS 26067** (INCOIS / Ministry of Earth Sciences).

## Positioning

**A continuous 3-D volume, not a 2-D map with layers.** The differentiator is
literal and technical: a raymarched `Data3DTexture` with trilinear filtering renders
the field as an unbroken gradient between depth levels, inside real seafloor
geometry. Competing ocean portals stack discrete slices or drape a surface field on
a globe; both make the vertical axis something you click through instead of
something you see.

Three things a neighboring product cannot truthfully copy without doing the same
work, all validated in the two spikes:

- the **depth-remap LUT** that puts non-uniform GLORYS levels (1 m → 74 m spacing,
  a 70× ratio) at physically correct heights instead of evenly-spaced slabs;
- the **validity channel** that stops trilinear filtering from bleeding land and
  below-seafloor values into water at coastlines;
- the honest **seafloor termination** — the field visibly ends where the real
  bathymetry says it does.

## Operating Context

Two deployment situations, both real:

1. **Hackathon demo.** A laptop, an unreliable or absent network, a fixed number of
   minutes, a projector. The filesystem cache is pre-warmed with the two validated
   tiles so the app runs fully offline. Anything that only works with live
   Copernicus access is a demo liability.
2. **Deployed web tool for institutional staff.** The near-term demo constraint must
   not foreclose this — architecture, data plumbing, and API surface are built for a
   hosted tool that people return to, not a one-off pitch artifact.

Data reaches the user through a FastAPI backend that fetches from Copernicus Marine,
derives render products, and caches both on disk keyed by region + date + variable.
Nothing re-downloads once cached.

## Capabilities and Constraints

**Working today**
- Volumetric raymarching of GLORYS12V1 `thetao` (temperature) over two validated
  regions: `coastal` (Sri Lanka shelf & Bay of Bengal, 79.5–84.5°E / 6–11°N) and
  `open` (Central Bay of Bengal, 85–90°E / 10–15°N), date 2020-01-01.
- Free-fly navigation (WASD/QE, drag-look, scroll speed) and orbit, with a soft
  containment clamp that follows the real seafloor, plus a Home view.
- Hover readout (leader-line HUD: lat/lon/depth/value) and click-to-pin detail.
- Top-down minimap with real coastline, live camera marker and pinned point.
- Depth clip, opacity, vertical exaggeration, fly speed, synthetic-detail toggle.

**Committed, not yet built** — these are real roadmap commitments, not speculation:
- **Salinity (`so`) and currents (`uo`)** — currently present in the variable list,
  marked SOON and disabled. Currents are vector data and will not fit the existing
  scalar transfer function unchanged.
- **Time animation** — playback across dates, replacing today's single fixed tile.
  The current cache key already includes date; the UI has no time axis at all yet.
- **Natural-language query** — ask the ocean a question in plain language. A Groq
  key exists in the environment; nothing is wired up.
- **Wider coverage** — beyond the two validated tiles: a region picker, or the
  broader Indian Ocean basin.

**Hard technical constraints**
- `thetao` reaches only **454 m**; bathymetry reaches **4183 m**. Below 454 m there
  is no field data, and the interface must say so rather than extrapolate.
- Land/water is a binary 1/12° mask — coastlines are genuinely ~9 km blocky. This is
  the data's resolution, not a rendering defect, and must not be smoothed into a lie.
- The depth axis is **non-linearly exaggerated** (curve 0.42, one shared mapping in
  `backend/adapters/bathymetry.py::depth_to_ynorm`) so shelf and abyss are legible
  together. Any depth read off the screen by eye is distorted by design; the labelled
  value is the truth.
- Target hardware includes integrated GPUs. The raymarch step budget and the choice
  of a uniform-array LUT over a per-step texture fetch (~35% of frame time on the
  target iGPU) both exist because of this.

**Terminology used with the user** — GLORYS12V1, Copernicus Marine, `thetao`,
thermocline, shelf break, bathymetry, depth level, water column, PSU.

**Undecided** — hosting/deploy target; whether the region picker is a map, a list,
or free bbox selection; how vector currents are represented; whether time playback is
scrubbed, stepped, or animated continuously.

## Brand Commitments

- Name: **Ocean-Viz**. No logo, wordmark, or brand palette exists yet.
- **P3 — synthetic data must be disclosed.** The sub-grid seafloor texture layered
  on real bathymetry is decorative, zero-mean synthetic detail. It is disclosed
  on-screen and toggleable. No future work may drop, shrink, or soften that
  disclosure, and nothing else synthetic may enter unlabelled.
- **P7 — never guess dataset structure.** Dimension order, units, fill conventions,
  and depth levels get verified against the actual file before code depends on them.
- Voice in the interface today: terse, technical, unhyped — measurement-instrument
  register, real units always shown. Treat as established unless deliberately changed.

## Evidence on Hand

- **Real data, in the repo's warm cache**: GLORYS12V1 `thetao` and GLORYS static
  bathymetry (`deptho`, `mask`, `deptho_lev`) for both validated tiles.
- **`spike-real-data/INSPECTION.md`** — the verified structure report for both
  datasets (dimension order, units, NaN semantics, all 31 depth levels, a real
  vertical profile). This is the P7 record; it is fact, not assumption.
- **`spike/SPIKE_FINDINGS.md`**, **`spike-real-data/FINDINGS.md` / `FIXES.md`** —
  what was tested and what the failures actually were.
- **`README.md` "Carried forward from the spikes"** — the load-bearing decisions
  (depth LUT, thickness-aware density, validity channel + dilate-fill, guard row,
  shared `depth_to_ynorm`, bicubic terrain, tuned fog/density). Validated, not
  decoration; do not re-derive or quietly drop them.
- Working screenshots in `frontend/screenshots/`.

**Absences that must not be fabricated**: no users, no institutional endorsement, no
INCOIS relationship, no benchmarks, no pricing, no deployment, no testimonials. There
is exactly one date of data for one variable over two tiles.

## Product Principles

1. **The vertical axis is the product.** Anything that flattens the ocean back into
   a map with layers is a regression, however convenient.
2. **Never let a rendering read as data it isn't.** Missing data looks missing;
   synthetic detail is labelled; the exaggerated depth axis is disclosed; the number
   in the readout is the authority, not the pixel.
3. **Two audiences, one build.** Correct for the analyst, self-explaining for the
   evaluator. Neither is served by a stripped-down mode.
4. **Offline-capable by default.** A warm cache is the normal operating state, not a
   fallback; live fetch is the optional path.
5. **Verified beats assumed.** Structure gets inspected (P7), fixes get confirmed to
   actually change something, and honest limits get stated instead of papered over.

## Accessibility & Inclusion

No product-specific standard has been established. Two known needs follow from the
constraints above and should not be lost: temperature is currently encoded by color
alone (the pinned readout and colorbar are the non-color channel — keep them), and
all navigation is currently drag-and-WASD with no non-pointer path to reach a point
in the volume.
