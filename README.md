# Ocean-Viz

**A browser-based 3-D explorer for operational ocean data.**
Smart India Hackathon **PS 26067** — INCOIS / Ministry of Earth Sciences.

Ocean-Viz takes Copernicus **GLORYS12V1** reanalysis and renders a region of the
ocean as a solid volume you can cut open, probe and reason about — then computes
the quantities a forecaster actually acts on, live, from the data already loaded.

> **Status:** working prototype. Real data end to end — no mock feeds, no
> placeholder fields. Five of the problem statement's five gaps are addressed;
> three are fully closed. See [Capability status](#capability-status).

---

## Contents

- [The problem](#the-problem)
- [Scope](#scope)
- [Approach](#approach)
- [Architecture](#architecture)
- [Datasets](#datasets)
- [Repository structure](#repository-structure)
- [Capability status](#capability-status)
- [Getting started](#getting-started)
- [Engineering decisions worth knowing](#engineering-decisions-worth-knowing)
- [Roadmap](#roadmap)
- [Known limits](#known-limits)
- [Documentation map](#documentation-map)

---

## The problem

Ocean models are four-dimensional — longitude, latitude, **depth**, time — and
almost every tool for looking at them throws the third dimension away. You get a
surface map with a depth dropdown, and you rebuild the vertical structure in your
head by clicking through slices.

That is not a cosmetic complaint. It has operational consequences:

> Sea-surface temperature tells you the ocean is warm. It cannot tell you **how
> deep** the warm layer goes — and depth is what decides whether a cyclone
> crossing that water intensifies or fizzles.

PS 26067 names five gaps. Verbatim:

1. No web-based 3-D depth-resolved volumetric views of model fields.
2. No unified display of Argo / glider / CTD profiles **alongside** model fields.
3. No interactive controls for variable selection, depth-slice navigation,
   time-step animation, colorbars.
4. No extensible ingestion of new variables and sensors.
5. No tools for intuitive, rapid understanding of complex 3-D phenomena.

Gap 5 is the one that matters most and is easiest to fake. "Understanding" is not
a prettier render — it is a derived, decision-relevant number with a threshold
attached, and an honest statement of where it came from.

---

## Scope

**In scope**

- A region of a real ocean model, loaded on demand and rendered as a bounded
  3-D volume with real bathymetry.
- Interrogation: hover, pin, slice, section, profile, transect.
- Real in-situ observations drawn in the same scene and compared on shared axes.
- Derived operational quantities computed in the browser from the loaded volume.
- Provenance on every surface — data, derived, or decoration.

**Out of scope, deliberately**

- A global ocean portal. This is a *tile* explorer: 1.5°–10° per side, loaded
  when you ask for it.
- Forecasting. Ocean-Viz reads a reanalysis; it does not predict.
- Automated feature detection (eddy tracking, front detection). Users can *see*
  structure; the app does not claim to find it. See
  [Roadmap](#roadmap) for why.
- Classroom or public-outreach framing. Legibility is a demo constraint here,
  not a product goal.

**Two audiences, one build.** Ocean scientists need precision and provenance;
hackathon judges need to understand it in ten minutes. There is no separate
"presentation mode" — where the two pull apart, correctness wins on substance
and clarity wins on first impression. Nothing is simplified into being wrong,
and nothing correct is left unexplained.

---

## Approach

Four ideas carry the whole build. Everything else is a consequence of one of them.

### 1. A bounded object, not an infinite volume

The ocean is rendered as a **finite chunk you walk around** — a torn block of
seafloor cut clean through by two knife planes, like a sliced tennis ball showing
a smooth face against a rough exterior.

This is a deliberate reversal of the obvious approach (fly through a fogged
volume). A bounded object has edges, and edges are where the honest statements
live: the cut faces are exact vertical cross-sections, the torn faces carry no
data and report none, and the field visibly stops where the real bathymetry says
it does. There is no fog, because an exponential falloff would dissolve those
edges and take the whole point with it.

### 2. Compute in the browser, not on the server

Every derived quantity — isosurfaces, the 26 °C isotherm depth, heat content,
contours — is arithmetic over the **same bytes already in memory** for rendering.
No second endpoint, no round trip, no chance of the picture and the number coming
from different sources.

One consequence: a derived layer toggles in milliseconds, and its number under
the cursor is provably the number being drawn.

### 3. One definition of everything shared

Where two parts of the system could disagree, they are made to read the same
definition instead:

| One definition | Shared by |
|---|---|
| Vertical mapping `ynorm = (m / bathy_max)^0.42` | shader, depth ruler, point picker, charts, camera |
| The colour ramp (256-entry LUT built from byte stops) | shader, isosurface, glider ribbon, chart strokes, colorbar |
| The RG8 volume buffer | GPU texture, CPU sampler, isosurface mesher, heat-potential maths |
| Block geometry in world space | every layer that draws inside the block |

This is why a depth means the same thing everywhere, and why a colour on the
block and a colour on a chart for the same value are the same three bytes —
verified, not assumed.

### 4. Honest labelling as a first-class feature

Every layer carries a badge, and each badge is a *distinct claim*:

| Badge | Claim |
|---|---|
| **REAL** | Measured or modelled data as published |
| **DERIVED** | Computed here from the loaded volume; reproducible from the same bytes |
| **STYLIZED** | Decoration. Disclosed and toggleable |
| **SOON** | The interface exists, the data or the maths does not — shows an em dash, never a plausible zero |

Two rules follow, and the app actually honours them:

- **An empty layer says it is empty.** "No Argo float here ±10 d — empty, not
  hidden" is a different statement from a layer that failed to load.
- **A disclosure that stops being true disappears.** The footer claims a stylized
  sea surface only while one is on screen — not after the block is sliced (the
  top is then a real section), and not when a derived field is drawn over it.

---

## Architecture

```
        Copernicus Marine                 Ifremer ERDDAP
        (GLORYS12V1, bathy)               (Argo GDAC, OceanGliders GDAC)
                │                                    │
                ▼                                    ▼
   ┌──────────────────────────────────────────────────────────┐
   │  BACKEND — FastAPI                                       │
   │                                                          │
   │   adapters/     subset · derive · normalise · mask       │
   │   cache/        raw NetCDF  +  derived render products   │
   │                                                          │
   │   Derivation happens ONCE per tile, on the server:        │
   │     • RG8 volume texture   R = value, G = validity        │
   │     • 128-entry depth LUT  (levels are non-uniform)       │
   │     • seafloor grid + height texture                      │
   └──────────────────────────────────────────────────────────┘
                │  JSON manifest  +  binary blobs
                ▼
   ┌──────────────────────────────────────────────────────────┐
   │  FRONTEND — React + Three.js (@react-three/fiber)        │
   │                                                          │
   │   dataset.js     one buffer  ──┬── GPU  Data3DTexture     │
   │                                └── CPU  sampler           │
   │                                                          │
   │   DERIVED IN THE BROWSER, from that same buffer:          │
   │     isosurface (marching tetrahedra)                      │
   │     D26 + TCHP (depth integral)                           │
   │     threshold contours (marching squares)                 │
   │                                                          │
   │   scene/     the block, and every layer drawn inside it   │
   │   ui/rail/   all controls, inside the canvas              │
   │   charts/    profile · transect · model-vs-observation    │
   └──────────────────────────────────────────────────────────┘
```

**Why the split falls there.** The server does what needs the source files and
the credentials — subsetting, decoding, masking, normalising — and does it once
per tile into a cache. The client does what needs to be interactive. Nothing that
a user can change with a slider requires a round trip.

**Transport is binary, not JSON.** A 73 × 32 × 73 volume as JSON numbers would be
megabytes of text to parse; as an RG8 buffer it is 341 KB that uploads straight to
a GPU texture with no transformation. The JSON manifest carries only the metadata
needed to interpret it.

**Three pages, one app.** Explorer (`#/`), Docs (`#/docs`, the technical document
rendered in-app) and Roadmap (`#/roadmap`, the PS gaps against what is actually
built) — a ~20-line hash router, no framework.

---

## Datasets

| Dataset | Used for | Notes |
|---|---|---|
| **GLORYS12V1** global ocean reanalysis<br>`cmems_mod_glo_phy_my_0.083deg_P1D-m` | Temperature (`thetao`), salinity (`so`), currents (`uo`/`vo`) | 1/12° ≈ 9 km, daily. Archive **1993-01-01 → 2026-06-23**, verified against the store's own time axis rather than the catalogue. 31 depth levels from 0.49 m to 453.9 m, non-uniformly spaced |
| **GLORYS static bathymetry**<br>`cmems_mod_glo_phy_my_0.083deg_static` (part `bathy`) | Seafloor geometry, land mask | `deptho`. Bounds the block and terminates every cut face |
| **Argo GDAC** via Ifremer ERDDAP | Measured T/S profiles from autonomous floats | Proxied server-side — ERDDAP sends no CORS headers. ±10 days of the model date, because an Argo cycle is ~10 days and none profiles daily |
| **OceanGliders GDAC** via Ifremer ERDDAP | Measured glider trajectories | Dataset `OceanGlidersGDACTrajectories`. No QC flags in source, and the UI says so |

**Region of interest: the Bay of Bengal.** Cyclone-prone, strongly stratified,
with a river-plume freshwater lens that makes salinity structurally interesting —
and INCOIS's own operational area. The default tile (79.5–85.5 °E, 12–18 °N)
carries coastline, shelf, slope and deep basin in one block, which is what makes
the vertical structure worth looking at.

**A finding from the data, not a design choice.** The pre-monsoon Bay is almost
uniformly above the 40 kJ/cm² cyclone-intensification threshold — measured across
five April–May tiles, the open-ocean ones run 96–100 % over it. The threshold
contour only becomes a *line* where the continental shelf cuts the depth integral
short. That is why the demo scenario uses a coastal tile: the physics decided it,
not the aesthetics.

---

## Repository structure

```
ocean-viz/
│
├── backend/                    Python · FastAPI
│   ├── main.py                 routes, region/preset config, caching, per-tile locks
│   ├── adapters/               one module per external source
│   │   ├── glorys.py           subset → RG8 volume + depth LUT + range policy
│   │   ├── bathymetry.py       deptho → world-space seafloor + the depth curve
│   │   ├── argo.py             Argo GDAC (ERDDAP)
│   │   └── gliders.py          OceanGliders GDAC (ERDDAP)
│   ├── verify_tchp.py          independent ground truth for the derived maths
│   └── cache/                  raw NetCDF + derived blobs (gitignored, regenerable)
│
├── frontend/                   JavaScript · React + Three.js
│   └── src/
│       ├── scene/              the 3-D block and every layer drawn inside it
│       │                       renderer, geometry, colour, and the derived maths
│       ├── ui/                 app bar, panels, charts shell, stat cards
│       │   └── rail/           the in-canvas control rail
│       ├── charts/             profile · transect · model-vs-observation
│       ├── interaction/        hover HUD, picking, depth probe
│       ├── currents/           streamline tracer and state
│       ├── observations/       the ObservationSource seam + its adapters
│       ├── pages/              Docs and Roadmap
│       └── state/              one zustand store, plus derived-value hooks
│
├── spike/                      throwaway — shader validation      (superseded)
├── spike-real-data/            throwaway — real-data validation   (superseded)
│
├── PROJECT_DOCUMENTATION.md    28-chapter technical document
├── OPERATIONAL_LAYER_SPEC.md   the derived-quantities spec and build order
├── INTERACTION_LAYER_SPEC.md   the interaction spec
└── HANDOFF_STATE.md            UI restructure brief and constraints
```

**The two `spike/` directories are kept on purpose.** They are throwaway
prototypes that answered two questions before the real build started — *can this
render at all?* and *does it survive real data?* — and the answers are why several
non-obvious decisions in the shipped code are what they are. They are not part of
the app.

**Three files in `frontend/src/scene/` are present but not mounted:**
`VolumeRaymarch.jsx` (superseded by the block renderer), `FreeFlyCamera.jsx` (the
app is orbit-only) and `BathymetryTerrain.jsx` (its mesh technique now serves the
derived surfaces). Kept for the record; do not read them as the render path.

---

## Capability status

Against the problem statement's own five gaps:

| # | Gap | State | What exists |
|---|---|---|---|
| 1 | 3-D depth-resolved volumetric views | **Live** | Real GLORYS rendered as a bounded block. Cut faces are exact vertical sections on the model's own 31 levels; the top becomes a real horizontal section once sliced. Marching-tetrahedra isosurfaces extract the 3-D shape of any value |
| 2 | Observations alongside model fields | **Partial** | Argo and gliders live from the GDACs, drawn in the same scene and compared on shared axes with mean \|Δ\| and worst-disagreement depth. CTD and drifters have no feed and are badged SOON |
| 3 | Interactive controls | **Partial** | Variable switching, slices snapped to real model levels, and a full colorbar editor (4 palettes, custom range, log/linear) are live. Time animation exists for currents only — the scalar field is a single day |
| 4 | Extensible ingestion | **Partial** | The seam is real and was proven, not asserted: swapping the Argo mock for the real GDAC adapter changed one line, because every consumer reads the `ObservationSource` contract. Variables are a declarative table. There is no plugin registry |
| 5 | Rapid understanding of 3-D phenomena | **Partial** | Slicing, probing, isosurfaces and animated streamlines are live, and the flagship operational quantity — **cyclone heat potential with the 26 °C isotherm depth** — is computed and rendered with its threshold contour. Thermocline, anomaly and drift are specified and seated, not yet wired |

### The flagship: cyclone heat potential

The one capability that answers gap 5 as an operational question rather than a
rendering one.

**D26** is the depth where temperature crosses 26 °C. **TCHP** is the heat stored
above it — `ρ·c_p·∫₀^D26 (T − 26) dz`, reported in kJ/cm², with the ~40 kJ/cm²
Bay of Bengal intensification threshold drawn as a contour. Height encodes D26,
colour encodes TCHP, so the layer has one legend and one threshold.

It is computed in the browser from the loaded temperature volume in 5–10 ms, and
verified against an independent Python implementation over the source NetCDF —
water columns, threshold crossings, censored columns and both grids' extrema all
agree exactly. The cost of reading it off an 8-bit texture is *measured* and
stated in the UI, not assumed: 0.26 kJ/cm² mean error, one column in 4,049
changing side of the threshold.

The demo line it enables: *"this warm pool clears 40 kJ/cm² and the warm layer is
120 m deep here — a cyclone crossing it would intensify. A 2-D SST map cannot
show the depth."*

---

## Getting started

**Prerequisites** — Python 3.12, Node 18+, and a free
[Copernicus Marine account](https://data.marine.copernicus.eu/register) (only
needed to fetch a tile that is not already cached). On Windows, run the backend
under WSL; `copernicusmarine` and `netCDF4` are far less painful there.

```bash
# backend  →  http://localhost:8000
cd backend
uv venv --python 3.12 && uv pip install -r requirements.txt
cp .env.example .env            # add CMEMS_USERNAME / CMEMS_PASSWORD
.venv/bin/uvicorn main:app --port 8000

# frontend →  http://localhost:5173
cd frontend
npm install && npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api/*` to the backend, so the browser
talks to one origin.

A few things worth knowing up front:

- **A warm cache serves fully offline.** `backend/cache/` is gitignored and
  regenerable — an empty cache is a valid clean checkout; the first request for a
  tile takes the download hit once (1–2 minutes), and never again.
- **The backend runs without `--reload`.** Config edits — regions, presets — need
  a restart.
- **Credentials live only in `backend/.env`**, which is gitignored.
  `.env.example` is the tracked template and holds placeholders.

**Verification.** `frontend/*.mjs` drives the real app with Playwright and prints
numbers rather than asserting silently, so a regression is visible in the output.
`backend/verify_tchp.py` is the independent ground truth for the derived maths.

---

## Engineering decisions worth knowing

The short list — the ones that would be expensive to rediscover.

- **Non-uniform depth levels are a first-class problem.** GLORYS levels run 0.49 m
  to 453.9 m with ~1 m spacing at the top and ~74 m at the bottom, a 70× ratio.
  A 128-entry lookup table maps box-depth fraction to texture row, so the field
  sits at physically correct heights instead of evenly-spaced slabs.
- **The volume carries its own validity mask.** RG8: `R` is the value,
  dilate-filled from valid neighbours so trilinear filtering near a coastline
  blends valid↔plausible; `G` is the true mask and is **never** dilated. Every
  reader gates on it. Without this, land bleeds into water at every coastline.
- **A guard row** — one extra all-invalid depth level — makes "no data below
  454 m" mask itself with no special-case shader code.
- **Marching tetrahedra, not marching cubes.** Six tets per cell sharing one
  diagonal: three topological cases each, correct by construction, rather than a
  4096-entry transcribed table where one wrong row is a hole no screenshot
  reliably catches. Three.js's `MarchingCubes` addon is a metaball renderer and
  is the wrong tool here — a documented trap, avoided.
- **Colour range policy is per variable, and physical.** Temperature gets a fixed
  clamp because its range is set by the thermocline, which every tile has.
  Salinity gets a per-tile range because its range is set by *geography* — 9.4 PSU
  in the Ganges plume, 36.7 in the Arabian Sea — and no fixed clamp survives that.
  The cost is disclosed: the same colour on two tiles is not the same salinity.
- **Buried layers are drawn twice**, the second pass with an inverted depth test,
  so a surface inside the block shows through only where the block is genuinely in
  front of it. Disabling the depth test instead would paint it over the near
  shell and read as a sticker.

---

## Roadmap

### Near term — completing the operational layer

The derived quantities are specified in `OPERATIONAL_LAYER_SPEC.md`, and their
toggles are already seated in the interface so wiring them changes no layout.

1. **Anomaly view** — value minus the tile's own mean at that depth on a diverging
   ramp. Also the fix for near-uniform fields that render flat.
2. **Thermocline depth** — depth of maximum |dT/dz| per column, as a warped
   surface. Same technique as the D26 sheet; directly useful for fisheries
   advisories.
3. **Drift trajectory** — forward particle advection through the measured current
   field for search-and-rescue. Extends the existing streamline tracer to a single
   seeded point over a time horizon.

### Mid term — depth of coverage

4. **Time animation for the scalar field.** Currents already animate across eight
   consecutive days; temperature and salinity are a single day with no date
   picker. This is the largest remaining gap in PS requirement 3.
5. **CTD and drifter feeds.** The `ObservationSource` seam already exists and was
   proven by the Argo swap; these are adapter work, not architecture work.
6. **More variables.** Mixed-layer depth, sea-surface height, oxygen. The variable
   table is declarative; the constraint is validating each one's range policy.
7. **Vertical sections along an arbitrary transect**, rather than the fixed
   west–east cut.

### Long term — from viewer to tool

8. **A real plugin architecture.** PS requirement 4 explicitly rewards
   extensibility. The seams exist; a registry and dynamic loading do not.
9. **Multi-tile and basin-scale views**, with level-of-detail — currently one tile
   at a time by design.
10. **Comparative mode** — two dates or two models side by side on locked cameras.
11. **Export**: the pinned column as CSV, the section as an image, the derived
    fields as NetCDF, so results leave the tool.

### Considered and deliberately excluded

Named so the absence reads as a decision:

- **Direct GPU volume rendering with transfer functions.** Heavy ray-casting for a
  qualitative result; isosurfaces give the quantitative answer far more cheaply.
- **Automated eddy detection and tracking.** An open research problem needing SSH,
  velocity and a detection algorithm. Users can see eddies in the streamlines; the
  app will not claim to have found them.
- **Neural-network TCHP from satellite altimetry.** The direct depth integral from
  the model's own temperature profiles is simpler, honest and valid — and we hold
  the profiles.

---

## Known limits

Stated plainly, because the alternative is discovering them in a demo.

- **The scalar volume stops at 453.9 m**; bathymetry on the default tile reaches
  3591 m. Below the model's extent the readout says so rather than extrapolating.
- **Land/water is a binary 1/12° mask**, so coastlines are visibly ~9 km blocky.
  Masked there, not filled.
- **The depth axis is non-linearly exaggerated** (curve 0.42, plus a user-set
  multiplier). Disclosed in the footer. One consequence: shallow structure has to
  be exaggerated further to read — the cyclone scenario raises it for that reason.
- **One variable is loaded at a time.** Layers needing temperature disable
  themselves with a stated reason on the salinity volume rather than fetching
  behind your back.
- **Sub-grid seafloor roughness is synthetic** — zero-mean, below the real grid
  spacing, tapered to nothing near land, toggleable, and disclosed. It never
  biases a real sounding.
- **Absolute heat-content values depend on a choice of constants.** The spatial
  pattern and which side of the threshold a column falls on are the robust claims;
  the UI says this next to the number.
- **`PROJECT_DOCUMENTATION.md` §8 and §10 describe an earlier layout.** The rest
  of that document is current.

---

## Documentation map

| Document | What it is |
|---|---|
| `PROJECT_DOCUMENTATION.md` | 28-chapter technical reference — also rendered in-app at `#/docs` |
| `OPERATIONAL_LAYER_SPEC.md` | The derived-quantities spec, their physics, and the build order |
| `INTERACTION_LAYER_SPEC.md` | The interaction layer and the PS gaps it answers |
| `HANDOFF_STATE.md` | UI restructure brief and its constraints |
| `PRODUCT.md` | Users, purpose, positioning |
| `#/roadmap` in the app | The five gaps and the build order, live against what is shipped |

---

Built for Smart India Hackathon PS 26067 — INCOIS, Ministry of Earth Sciences.
Data © Copernicus Marine Service; Argo and OceanGliders data from the Ifremer
GDACs.
