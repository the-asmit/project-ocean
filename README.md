# Ocean-Viz

**Interactive 3-D visualisation of oceanographic data** — Smart India Hackathon
PS **26067**, INCOIS / Ministry of Earth Sciences.

A browser-based explorer for a real ocean model. It loads a tile of Copernicus
**GLORYS12V1** reanalysis, renders it as a bounded 3-D block you can cut open,
probe and slice, overlays real Argo and glider observations, and computes
operational quantities — cyclone heat potential and the depth of the 26 °C
isotherm — live from the loaded volume.

Every rendered surface says what it is. There is no place in this app where a
decorative surface, a derived quantity and a measurement look alike.

```
backend/           FastAPI + Copernicus Marine adapters + filesystem cache
frontend/          React + @react-three/fiber (Three.js)
spike/             throwaway — shader validation        (superseded, kept for the record)
spike-real-data/   throwaway — real-data validation     (superseded, kept for the record)
```

---

## Table of contents

- [Quick start](#quick-start)
- [What you are looking at](#what-you-are-looking-at)
- [Controls](#controls)
- [The control rail](#the-control-rail)
- [Honest labelling — the badge vocabulary](#honest-labelling--the-badge-vocabulary)
- [The cyclone layer (D26 + TCHP)](#the-cyclone-layer-d26--tchp)
- [Layers, and where each one comes from](#layers-and-where-each-one-comes-from)
- [Data sources](#data-sources)
- [How the rendering actually works](#how-the-rendering-actually-works)
- [API](#api)
- [Caching](#caching)
- [Repository layout](#repository-layout)
- [Verification](#verification)
- [Known limits](#known-limits)
- [Deliberately not built](#deliberately-not-built)
- [Further documentation](#further-documentation)

---

## Quick start

### Prerequisites

| | |
|---|---|
| **Python** | 3.12 (tested on 3.12.14). On Windows this project runs the backend under **WSL** — `copernicusmarine` and `netCDF4` are far less painful there. |
| **Node** | 18+ (tested on 24). |
| **Copernicus account** | Free — <https://data.marine.copernicus.eu/register>. Only needed to fetch a tile that is not already cached. |

### 1. Backend

```bash
cd backend
uv venv --python 3.12 && uv pip install -r requirements.txt
# or: python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt

cp .env.example .env          # then fill in your Copernicus username/password
.venv/bin/uvicorn main:app --port 8000
```

The server listens on **:8000** and mounts its routes at the root (`/health`,
`/dataset`, …). It is **not** started with `--reload`, so **editing `main.py` —
including the region and preset lists — needs a restart.**

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Vite proxies `/api/*` → `http://localhost:8000/*` (see `frontend/vite.config.js`),
so the browser only ever talks to one origin.

### 3. Open it

<http://localhost:5173> — it loads the **Bay of Bengal, India east coast** tile
(79.5–85.5 °E, 12–18 °N) for **2026-06-11** and takes a few seconds if the tile
is cached, or 1–2 minutes if it has to be fetched from Copernicus.

### Credentials

Read from `backend/.env` as `CMEMS_USERNAME` / `CMEMS_PASSWORD`. `.env` is
gitignored; `.env.example` is the tracked template and contains placeholders
only. **Never commit real credentials.** `GET /health` reports whether
credentials were found without echoing them.

### Running offline

A warm cache serves fully offline. `backend/cache/` is gitignored and is
regenerated on demand, so an empty cache is a valid clean checkout — the first
request for a region/date/variable simply takes the download hit once.

### Production build

```bash
cd frontend && npm run build && npm run preview
```

---

## What you are looking at

```
┌─────────────────────────────────────────────────────────────────────────┐
│  APP BAR    model · date · region · field                    Explorer   │
├──────────────────┬──────────────────────────────────────────────────────┤
│                  │                                                      │
│    MAP VIEW      │              3D VOLUME                               │
│  North Indian    │   ▌ icon rail (Field · Section · Operational ·        │
│  Ocean basemap   │   ▌ Scale · Tools) — every control lives in here      │
│  drag a box to   │                                                      │
│  load a tile     │   depth ruler · section badge · legends · HUD         │
│                  │   timeline · orbit hint                              │
├──────────────────┴───────────┬──────────────┬──────────────┬────────────┤
│  PINNED POINT (read-only)    │  PROFILE     │  TRANSECT    │ MODEL VS   │
│  8 stat cards                │  depth curve │  W→E section │ FLOAT      │
├──────────────────────────────┴──────────────┴──────────────┴────────────┤
│  SOURCE / provenance footer — what is real, what is derived, what is     │
│  stylized, and the projection                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

Three pages, via a hash router: **Explorer** (`#/`), **Docs** (`#/docs`, the
28-chapter technical document rendered from `PROJECT_DOCUMENTATION.md`) and
**Roadmap** (`#/roadmap`, PS requirements against what is actually built).

The 3-D block is a **bounded object you walk around**, not a space you fly
through: a rugged, torn chunk of seafloor cut clean through by two knife planes.
The torn sides carry no data and report none; the flat cut faces are real
vertical cross-sections through the volume.

---

## Controls

### Mouse

| | |
|---|---|
| **drag** | orbit the block |
| **scroll** | zoom |
| **hover a cut face** | live readout — leader-line HUD with lat / lon / depth / value |
| **click** | pin the point; the profile, the transect and the stat cards all follow it |
| **drag a box on the map** | load that tile (1.5–10° per side) |

### Keyboard

| | |
|---|---|
| `H` | reset the camera to the home framing |
| `Esc` | leave full view, or clear the pin |
| `↑` `↓` | move the depth cursor one model level |

Panning is deliberately disabled — the block is a display object with a fixed
centre. There is no fly mode in the shipped app (see
[Known limits](#known-limits)).

---

## The control rail

Every interactive control lives **inside the 3-D canvas**, behind a 58 px icon
strip. Exactly one panel is open at a time; closed means *unmounted*, not
hidden, so there is never a second copy of a control anywhere in the app.

| Group | What is in it |
|---|---|
| **Field** | Variable (Temperature / Salinity), bathymetry + synthetic detail toggle, Argo floats, gliders, current flow lines |
| **Section** | Slice from the top, slice from the west, vertical exaggeration, isotherm contours |
| **Operational** | **Cyclone heat potential (live)**, thermocline depth *(soon)*, drift trajectory *(soon)*, isosurface |
| **Scale** | Palette (Ocean / Viridis / Red–Blue / Mono), custom display range, linear ↔ log, reset |
| **Tools** | Region select, and measurement tools *(soon)* |

---

## Honest labelling — the badge vocabulary

This is the part of the project worth stealing. Every layer carries a badge, and
each badge is a distinct claim:

| Badge | Means |
|---|---|
| **REAL** | Measured or modelled data as published. Argo profiles, glider tracks, GLORYS `uo`/`vo`. |
| **DERIVED** | Computed here, in the browser, from the loaded volume. Isosurface, D26, TCHP. Reproducible from the same bytes. |
| **STYLIZED** | Decorative. The sea surface on the top face, and the sub-grid seafloor roughness. Disclosed in the footer and toggleable. |
| **SOON** | The interface exists, the data or the maths does not. Never shows a zero or a plausible-looking placeholder — it shows an em dash. |
| **REQUIRED** | Structural and cannot be switched off (the seafloor bounds the block). |
| **MAP** | Always on, driven from the basemap. |

Two consequences the app actually honours:

- **An empty layer says it is empty.** "No Argo float here ±10 d — empty, not
  hidden" is a different statement from a layer that failed to load.
- **A disclosure that stops being true disappears.** The footer claims a
  stylized top face only while a stylized top face is on screen — not when the
  block has been sliced (the top is then a real horizontal section) and not when
  the TCHP field is drawn over it.

---

## The cyclone layer (D26 + TCHP)

The flagship operational feature, and the one thing here a 2-D SST map
physically cannot show. Sea-surface temperature tells you the ocean is warm;
**it cannot tell you how deep the warm layer goes**, and depth is what decides
whether a cyclone crossing it intensifies.

**D26** is the depth at which temperature crosses 26 °C going down, linearly
interpolated between the two bracketing model levels.
**TCHP** is the heat stored above it:

```
TCHP(x,y) = ρ · c_p · ∫[0 → D26] (T(z) − 26) dz        ρ = 1026 kg/m³
                                                        c_p = 3990 J/(kg·°C)
1 °C·m of excess  =  0.409374 kJ/cm²
```

Reported in **kJ/cm²**, the operational unit. The **~40 kJ/cm²** contour — the
commonly-cited Bay of Bengal intensification threshold — is drawn and labelled
on both surfaces.

**How it renders.** Height is D26, colour is TCHP, on both sheets, so the layer
has one legend and one threshold:

- The **D26 sheet** is a warped surface *inside* the block. It is drawn twice —
  once with an ordinary depth test for the part standing in open air, once with
  `depthFunc: GreaterDepth` so the buried part shows through only where the
  block is genuinely in front of it. Slice the top down past ~90 m to lift it
  out.
- The **TCHP field** is a horizontal sheet on the block's top face. It stands
  down while the block is sliced, because the top face is then a real
  cross-section and a sheet at depth 0 would hover over the very cut you made.
  The number stays live on the cursor and the stat cards — it was computed, not
  drawn.
- A **600 ms cubic ease-out** mount-in rises the sheet from flat at the sea
  surface to its true depth and walks the contour across. This moves a
  *drawing*, not a datum: both grids are computed in full before the first
  animated frame, and freezing it at any point shows the true D26 scaled by `t`.

**No new data.** It is one pass over `dataset.rg8` — the same `Uint8Array` the
3-D texture, the CPU sampler and the isosurface mesher all read. 5–10 ms per tile,
memoised on the dataset object. There is no endpoint behind it.

**Verified, not eyeballed.** `backend/verify_tchp.py` runs the identical
algorithm over the source NetCDF at float64, *and* over the exact 8-bit values
the browser sees. The browser is checked against the second for equality:

```
   OK   water columns  js  4049.0000   py  4049.0000
   OK   over 40        js  3845.0000   py  3845.0000
   OK   censored       js   326.0000   py   326.0000
   OK   d26 max        js   138.8026   py   138.8026
   OK   tchp max       js   168.3485   py   168.3485
```

**What the 8-bit volume costs, measured rather than assumed.** One code on the
`[8, 33] °C` clamp is 0.098 °C. Against float64: TCHP off by **0.26 kJ/cm² mean,
1.36 worst**; D26 sub-metre except on near-isothermal columns, where `dT/dz → 0`
makes the crossing ill-conditioned and the worst case measured was **7.8 m**.
**One column in 4,049 changes side of the 40 kJ/cm² line.** All of this is in
the panel copy, not just here.

**Caveats the UI states out loud.** ρ and c_p are the standard constants for the
direct depth-integral method, which is the right method when you hold full
temperature profiles. Other products use other conventions (NOAA's altimetry
method references 20 °C), so the absolute kJ/cm² is a physically-grounded
estimate and will not match a specific INCOIS product to the decimal. The
spatial pattern and which side of the threshold a column falls on are the robust
claims. The ~40 kJ/cm² figure is widely used and sound, but confirm the source
against current INCOIS/IMD literature before quoting it on a slide.

**Where the warm layer runs to the seafloor** — the shelf, or the volume's own
454 m extent — D26 is a lower bound and is printed as `≥ d`, never as a bare
depth.

**Needs the temperature volume.** One variable is loaded at a time; on salinity
the row disables with a stated reason rather than silently fetching `thetao`.

### Cyclone Scenario preset

One click loads **`bengal` / 2019-05-01**, temperature, the layer on, vertical
exaggeration at 14×.

A finding worth recording: **the pre-monsoon Bay of Bengal is almost uniformly
above 40 kJ/cm².** Measured across five April–May tiles, the open-ocean ones run
96–100 % over it — the contour has nothing to separate and never appears. It
becomes a *line* only where the shelf cuts the depth integral short, so the tile
has to carry coastline. This one puts **8.9 %** of its water columns under the
threshold with D26 spanning **6–122 m**.

The date is an ocean-state and calendar claim only: 1 May 2019 is two days
before Cyclone Fani made landfall at Puri. The preset copy explicitly declines
to say where the storm was on the day — that needs the IMD track.

---

## Layers, and where each one comes from

| Layer | Badge | Source |
|---|---|---|
| Temperature / salinity volume | REAL | GLORYS12V1 `thetao` / `so`, 31 levels to 453.9 m |
| Seafloor | REAL | GLORYS static `deptho` |
| Sub-grid seafloor roughness | STYLIZED | Zero-mean simplex noise, tapered to zero over land and in the surf zone, toggleable |
| Sea surface on the top face | STYLIZED | FBM water in the fragment shader; removed the moment the block is sliced |
| Isotherm contours on cut faces | DERIVED | Fixed interval per variable (2 °C for temperature) |
| Isosurface | DERIVED | Marching **tetrahedra** over the same RG8 volume |
| D26 surface + TCHP field | DERIVED | Depth integral over the loaded temperature volume |
| Current flow lines | REAL | GLORYS `uo`/`vo`, 8-day window, RK2 tracer through the measured field |
| Argo floats | REAL | Argo GDAC via Ifremer ERDDAP, ±10 days of the model date |
| Glider tracks | REAL | OceanGliders GDAC via Ifremer ERDDAP |
| Thermocline, anomaly, drift | SOON | Not computed yet |

### Two range policies, and why

Colour range is **per variable**, and the difference is physical, not cosmetic:

- **Temperature — `fixed` [8, 33] °C.** Its within-tile range is set by the
  vertical thermocline, which every tile has. One clamp means a colour is the
  same temperature on every tile. Badged **FIXED SCALE**.
- **Salinity — `tile`.** Its range is set by *geography* — 9.40 PSU in the
  Ganges-Brahmaputra plume, 36.69 in the Arabian Sea — nearly flat within a tile
  and enormous between them. No fixed clamp survives that. Badged **FITTED TO
  TILE**, and the cost is disclosed: the same colour on two tiles is not the same
  salinity.

The Scale panel adds a third state, **CUSTOM RANGE**, with one-click reset. A
custom range can narrow the displayed window but never widen it past what the
volume actually carries, because the backend clips values into the baked range
before quantising them.

---

## Data sources

| | |
|---|---|
| **Model** | GLORYS12V1 — `cmems_mod_glo_phy_my_0.083deg_P1D-m`, 1/12° ≈ 9 km, daily. Archive runs **1993-01-01 → 2026-06-23** (verified against the store's own time axis, not the catalogue). |
| **Bathymetry** | `cmems_mod_glo_phy_my_0.083deg_static`, part `bathy` (`deptho`). |
| **Argo** | Argo GDAC via `https://erddap.ifremer.fr/erddap/tabledap` — proxied server-side because ERDDAP sends no CORS headers. |
| **Gliders** | OceanGliders GDAC, dataset `OceanGlidersGDACTrajectories`, same ERDDAP. |
| **Projection** | WGS 84 · EPSG:4326. |

Named regions: `coastal` (Sri Lanka shelf, 79.5–84.5 °E / 6–11 °N), `open`
(central Bay, 85–90 °E / 10–15 °N), `bengal` (India east coast, 79.5–85.5 °E /
12–18 °N — the default, and the only one with real coastline *and* shelf
structure). Any `bbox:lonMin,lonMax,latMin,latMax` between 1.5° and 10° per side
also works.

---

## How the rendering actually works

The load-bearing pieces. Each was validated in a spike and is not decoration.

**One block, two knife cuts.** `chunkGeometry.js` builds a torn chunk whose
outer shell is displaced *inward* from a deterministic noise field seeded by the
tile key — same region, same tear, every reload. The cut faces are plain planar
quads exactly on the data box's boundary, so the cross-section is geometrically
identical to a flat wall. The fragment shader branches on a per-face `aKind`
attribute rather than the normal, because the torn shell's normals point
everywhere.

**One vertical mapping.** `depth_to_ynorm` in `backend/adapters/bathymetry.py`:
`ynorm = (m / bathy_max)^0.42`, `world_y = -6 · ynorm`. The shader, the depth
ruler, the point picker, the charts and the camera all read `blockLayout.js`,
which derives from it — so a depth means the same world Y everywhere. Scaling by
the temperature extent instead of the deepest sounding once flattened 65 % of
the seafloor.

**Depth LUT.** GLORYS levels are non-uniform: 31 of them from 0.49 m to 453.9 m,
spaced ~1 m apart at the top and ~74 m at the bottom. A 128-entry
lookup maps box-depth fraction to texture row, uploaded as a `uniform float[]` —
a per-step float-texture fetch measured ~35 % of frame time on the target iGPU.

**RG8 validity channel.** `R` = value normalised into the baked range and
dilate-filled from nearest valid neighbours, so trilinear filtering near a
coastline blends valid↔plausible rather than valid↔garbage. `G` is the true 0/1
mask and is **not** dilated. Everything that reads the volume gates on `G ≥ 128`.

**Guard row.** One extra all-invalid level, so "no data below 454 m" masks itself
with no extra shader code.

**One colour definition.** `frontend/src/scene/colorScale.js` builds a 256-entry
`DataTexture` from byte stops. The shader samples it at exact texel centres
`(0.5 + p·255)/256`, so a voxel, an isosurface, a glider ribbon, a chart stroke
and the colorbar swatch for one value are the same three bytes. JS↔GPU agreement
was verified at all 256 sample points for all four palettes: **worst byte
difference 0**.

**Marching tetrahedra, not cubes.** Each cell is split into six tets sharing the
0–6 diagonal (Kuhn's decomposition). Every tet has three topological cases, so
the algorithm is correct by construction rather than by the fidelity of a
4096-entry transcribed table — where one wrong row is a hole or a spike no
screenshot reliably catches. A cell is meshed only when all eight corners are
valid, which leaves a ragged open edge at the shelf and at the 454 m floor. That
edge is the honest answer, not a hole to be patched.

**Ghost passes.** The isosurface, the D26 sheet and the glider ribbon each draw
twice: once normally, once with `depthFunc: THREE.GreaterDepth` so the buried
part appears only where something is genuinely in front of it. `depthTest: false`
would paint the surface over the block's near shell and read as a UI layer
pasted on top.

**No fog, no glass.** An exponential falloff would dissolve the block's far
edges and undo the point of a bounded object. Translucency is overlay language,
and nothing here floats.

---

## API

All routes are served at the root of `:8000`, and reached from the browser as
`/api/*` through the Vite proxy.

| Endpoint | Returns |
|---|---|
| `GET /health` | status, whether credentials were found, and what is cached |
| `GET /regions` | named regions, selection limits, variables, default date, presets |
| `GET /dataset?region=&date=&variable=` | JSON manifest — dims, depth levels, depth LUT, ranges, provenance |
| `GET /slice/volume?region=&date=&variable=` | binary RG8 3-D field (R = value, G = validity) |
| `GET /bathymetry/meta?region=` | JSON — grid dims, depth curve, box span, land-cell count |
| `GET /bathymetry?region=` | binary f32 seafloor world-Y grid (NaN = land) |
| `GET /bathymetry/height?region=` | binary u8 seafloor height texture |
| `GET /point?lat=&lon=&depth=&region=&date=&variable=` | on-demand point query straight from the source NetCDF, full precision |
| `GET /currents/meta?region=&date=` | JSON — dates, depth levels, speed percentiles |
| `GET /currents/field?region=&date=&frame=` | binary u/v field for one day |
| `GET /argo/floats?region=&date=&days=` | Argo floats in the window, with WMO / DAC / data mode |
| `GET /argo/profile?wmo=&cycle=` | one measured Argo profile |
| `GET /gliders/tracks?region=&date=&days=` | glider deployments intersecting the tile |
| `GET /gliders/track?deployment=&region=` | one full track |

`/point` exists so the client's own reading — taken off the 8-bit texture — can
be shown next to the authoritative value from the source file. Drift between them
is visible rather than hidden; anything larger than the 0.098 °C quantisation
step is a bug.

---

## Caching

```
backend/cache/raw/<key>.nc          Copernicus downloads
backend/cache/derived/<key>/        render products (RG8 volume, height texture, meta)
```

Keyed by region + date + variable. Free bboxes are rounded to 2 dp so the same
drawn rectangle always resolves to the same tile. Nothing re-downloads once
cached, and per-key locks mean two simultaneous requests for the same tile
produce one fetch. The whole directory is gitignored and regenerable.

---

## Repository layout

```
backend/
  main.py                    FastAPI app, regions, presets, caching, locks
  adapters/
    glorys.py                subset + RG8 volume derivation + depth LUT
    bathymetry.py            deptho -> world-Y grid, height texture, depth curve
    argo.py                  Argo GDAC via Ifremer ERDDAP
    gliders.py               OceanGliders GDAC via Ifremer ERDDAP
  verify_tchp.py             ground truth for D26/TCHP, and the preset screener
  cache/                     gitignored, regenerable

frontend/src/
  App.jsx                    page shell, hash routing, the provenance footer
  router.js                  ~20-line hash router
  scene/
    OceanScene.jsx           canvas, camera, orbit controls, layer mounting
    DioramaBlock.jsx         THE renderer — torn chunk + cut faces + shader
    chunkGeometry.js         the torn shell, its rings and its outlines
    blockLayout.js           single definition of the block in world space
    dataset.js               loader + CPU sampler over the same RG8 bytes
    colorScale.js            THE colour definition — 4 palettes, one LUT
    marchingCubes.js         marching tetrahedra (isosurface)
    contourLines.js          marching squares (threshold contours)
    heatPotential.js         D26 + TCHP maths
    HeatPotential.jsx        the cyclone layer's sheets, contour and mount-in
    Isosurface.jsx  GliderRibbon.jsx  ObservationMarkers.jsx
    sliceStops.js  isoRange.js  seafloorDetail.js
  currents/                  streamlines + currents state
  observations/              ObservationSource seam, Argo and glider adapters
  interaction/               hover HUD, point picking, depth probe, pinned controls
  charts/                    profile, transect, model-vs-float comparison
  ui/                        app bar, panels, minimap, colorbar, stat cards
    rail/                    the in-canvas icon rail and its panels
  pages/                     Docs and Roadmap
  state/                     zustand store and the derived-value hooks
```

### Modules present but not mounted

Three files are kept for the record and are **not** part of the render path.
Do not assume they describe the shipped app:

- `scene/VolumeRaymarch.jsx` — the spike's raymarcher. `DioramaBlock.jsx`
  superseded it; its data path (LUT, validity channel, transfer function) was
  carried over verbatim.
- `scene/FreeFlyCamera.jsx` — the old fly mode. The shipped app is orbit-only.
- `scene/BathymetryTerrain.jsx` — the displaced terrain mesh. The seafloor is
  drawn in `DioramaBlock`'s fragment shader now, but this file is the source of
  the mesh technique the D26 sheet uses, so it is documentation as much as code.

---

## Verification

Scripts live in `frontend/*.mjs` and drive the real app with Playwright against
a running dev server. They print numbers rather than asserting silently, so a
regression is visible in the output.

```bash
cd frontend
node shot-heat.mjs        # D26 + TCHP: JS vs Python, mesh counts, readouts, salinity gating
node shot-cyclone.mjs     # the Cyclone Scenario preset, end to end
node shot-mountin.mjs     # the 600 ms mount-in: curve, duration, reduced-motion
node verify-colorbar.mjs  # JS <-> shader ramp agreement at 256 points, per palette
node shot-step4.mjs       # layout regression: no duplicate control paths
node shot-footer.mjs      # footer line count under every layer combination
```

Ground truth for the operational layer is Python, not another copy of the same
JavaScript:

```bash
cd backend
.venv/bin/python verify_tchp.py cache/raw/vol_bengal_2026-06-11_thetao.nc
```

It prints the float64 result, the RG8 result the browser should match exactly,
the quantisation cost between them, and ASCII maps of both fields.

---

## Known limits

Stated plainly, because the alternative is someone discovering them in a demo.

- **The temperature volume stops at 453.9 m**; bathymetry on the default tile
  reaches 3591 m. Below the model's extent the readout says so rather than
  extrapolating, and the guard row masks it in the shader.
- **Land/water is a binary 1/12° mask**, so coastlines are visibly ~9 km blocky.
  It is masked there, not filled.
- **The depth axis is non-linearly exaggerated** (curve 0.42, plus a user-set
  multiplier defaulting to 8×). Disclosed in the footer. One consequence worth
  knowing: D26's full 6–139 m range occupies only about a fifth of the block's
  height at 8×, which is why the Cyclone Scenario preset raises it to 14×.
- **One variable is loaded at a time.** Layers that need temperature disable
  themselves with a stated reason on the salinity volume rather than fetching
  behind your back.
- **Salinity uses a per-tile colour range**, so the same colour on two tiles is
  not the same salinity. Badged FITTED TO TILE.
- **Region select is unreachable in full view** — the map is a sibling panel, so
  full view covers it. `Esc` gets you out in one key.
- **The synthetic seafloor roughness is fake by construction.** Zero-mean, below
  the real grid spacing, tapered to nothing near land, toggleable, and disclosed.
  It never biases a real sounding.
- **No fly-through.** `FreeFlyCamera.jsx` still exists but nothing mounts it.
- **The backend has no `--reload`.** Config edits need a restart.
- **`PROJECT_DOCUMENTATION.md` §8 and §10 describe the pre-restructure layout**
  and predate the cyclone layer. The rest of that document is current.

---

## Deliberately not built

Researched and excluded, per `OPERATIONAL_LAYER_SPEC.md` §8 — named here so the
absence is a decision rather than a gap:

- **Direct GPU volume rendering with transfer functions.** Heavy ray-casting;
  isosurfaces give the quantitative value far more cheaply.
- **Automated eddy detection / tracking.** An open research problem needing SSH,
  velocity and a detection algorithm. Users can *see* eddies in the streamlines;
  the app does not claim to find them.
- **Neural-network TCHP from satellite SSHA.** The direct depth integral from the
  GLORYS temperature volume is simpler, honest and valid.

---

## Further documentation

| | |
|---|---|
| `PROJECT_DOCUMENTATION.md` | 28-chapter technical document, also rendered at `#/docs` |
| `OPERATIONAL_LAYER_SPEC.md` | the operational-layer spec and its build order |
| `INTERACTION_LAYER_SPEC.md` | the interaction-layer spec |
| `HANDOFF_STATE.md` | the UI restructure brief and its constraints |
| `PRODUCT.md` | product context |

Build order for what remains: anomaly view, model-vs-Argo profile overlay,
thermocline-depth surface, drift trajectory.
