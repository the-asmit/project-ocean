# Ocean-Viz — Interaction Layer Spec (turning the data-box into a research instrument)

> Paste this into the Claude Code session that owns the Ocean-Viz frontend (the
> build that already renders real GLORYS12V1 data as a 3D block with pin-to-
> inspect). This spec does NOT change the rendering foundation — it adds the
> **interaction capabilities that make the 3D actually useful to researchers.**
> It is grounded in the SIH problem statement and in how oceanographers actually
> analyze 3D ocean data.

---

## 1. THE PROBLEM (SIH 26067 — why this tool exists)

MoES/INCOIS produces large 3D ocean model fields (temperature, salinity,
currents, chlorophyll) across depth and time, plus in-situ observations from
Argo floats, gliders, CTDs. Today oceanographers must switch between separate,
mostly-2D, desktop tools to inspect model fields and observations, and cannot
easily correlate model predictions with observational evidence in one place.

The PS asks for a browser-based 3D system that lets a forecaster **rapidly,
intuitively interrogate the 3D ocean and compare model output against
instrument data** — to speed up hazard assessment, search-and-rescue, fishery
advisories, and climate monitoring, plus serve as an outreach/education tool.

**The PS's explicitly stated gaps (these are the scoring criteria):**
1. No web-based 3D **depth-resolved volumetric** views of model fields.
2. **No unified display of Argo/Glider/CTD profiles ALONGSIDE model fields.**
3. No interactive controls for variable selection, **depth-slice navigation**,
   time-step animation, colorbars.
4. No extensible ingestion of new variables/sensors.
5. No tools for **intuitive, rapid understanding of complex 3D phenomena**.

Gap #2 (co-visualize + compare model vs observation) is the headline
differentiator — keep it front of mind.

---

## 2. WHAT THE CURRENT BUILD DOES WELL (keep all of this)

- Renders **real GLORYS12V1** data (Copernicus) as a 3D block — cut faces show
  real temperature; provenance is labeled honestly (real data vs stylized top).
- **Pin-to-inspect**: click a point → value with server verification → profile
  and transect follow the pinned point.
- Honest vertical exaggeration (non-linear depth curve, ruler reads true metres).
- Clean dark volumetric-explorer UI, map region select, transect + profile
  panels, isotherm contours.

This is a strong, credible foundation. Do not rebuild it. Build ON it.

---

## 3. THE CORE GAP (why it's not yet a research instrument)

Right now the block is effectively a **sealed box**: temperature is painted on
its *outer faces*, and the user can read values on the *surface* of the box, but
cannot reach *inside* the volume. There is:
- no way to **slice into the interior** at an arbitrary depth or transect,
- no way to **probe an interior point** (only edges/surfaces read),
- no way to **extract a feature buried inside** the volume,
- no **model-vs-observation comparison**.

This makes it 3D in *shape* but 2D in *access* — a researcher could reasonably
ask "why not just show me stacked 2D maps?" The third dimension has to earn its
place by letting the user get *inside* the data. That is what this spec adds.

---

## 4. WHAT OCEANOGRAPHERS ACTUALLY DO (the workflow to support)

Per the ocean-visualization literature (VAPOR, pyParaOcean and related systems),
the oceanographer's core 3D workflow is:
- inspect **temperature/salinity distributions and vertical cross-sections**,
- **query depth profiles** interactively at chosen locations,
- **compare measured (Argo/glider) data against model data**,
- inspect **currents / circulation** via flow lines,
- identify **features** (thermocline, water masses, eddies, fronts, anomalies).

The standard techniques that serve this workflow — and that we should implement —
are: **interactive slicing (cut planes), depth-profile query, isosurfaces, and
flow lines**, with **model-vs-observation overlay**. (Full GPU volume rendering
with transfer functions is the advanced technique — see §6, out of scope.)

---

## 5. WHAT TO BUILD (ranked by researcher-value × feasibility)

All of the following are built on the **full 3D data volume already loaded**
(lon × lat × depth array). The key realization: the app already fetches the
volume; it just isn't *sampling the interior* yet. Everything below is sampling
+ light geometry, not new heavy rendering.

### TIER 1 — MUST-HAVE (kills the sealed-box problem; high feasibility)

**5.1 Interior cut planes (arbitrary slicing).**
Let the user slice into the volume and see **real interior data** on the cut:
- **Horizontal depth slice:** a movable horizontal plane at any depth. As the
  depth slider moves, sample the volume at that depth level (nearest or
  interpolated), build a texture, and display it on the plane *inside* the block.
  (The existing "SLICE FROM TOP (off)" control is the seed — make it live: it
  should cut the block down from the surface and texture the new top cap with the
  data at that depth.)
- **Vertical cross-section:** a movable vertical plane along a lat line, a lon
  line, or a user-drawn transect A→B. Sample the volume along that line for all
  depths → a (distance × depth) texture → display on the vertical plane inside
  the block. This is the "vertical cross-section" oceanographers use constantly.
- Implementation: sample the loaded 3D array along the plane's grid, write to a
  `CanvasTexture` (using the same colormap as the faces), map onto a plane mesh.
  Use `material.clippingPlanes` to cut the box so the interior plane is visible.
  Re-sample/re-texture only when the slice moves (not every frame).

**5.2 Interior depth-column probe (profile query anywhere).**
Extend pin-to-inspect so it reads the **full water column**, and works on
interior cut faces, not just outer edges:
- Click anywhere (outer face OR an exposed interior cut plane) → get lon/lat →
  extract the entire depth profile `T[lon][lat][:]` from the volume → draw
  temperature-vs-depth in the profile panel, with the true value + server
  verification already implemented.
- Add a "depth cursor": once a lon/lat is picked, a slider moves a probe marker
  *down through the water column* in 3D, reading the interior value at each depth.
- This directly fixes "cursor only reads edges" — the cut face becomes a movable
  interior surface the user reads off.

### PS-CRITICAL — MODEL vs OBSERVATION (the PS's #1 gap; high feasibility)

**5.3 Argo/Glider overlay + model-vs-observation profile comparison.**
This is the PS's headline requirement and the main differentiator:
- Show Argo floats / gliders as geospatially accurate 3D markers in the same
  scene as the model volume (their real lat/lon/depth positions).
- Click a float → show its **measured** depth profile.
- **Overlay it against the MODEL profile** at the same lat/lon/time on the same
  chart — two curves (observation vs model), so the forecaster can instantly see
  where the model agrees/diverges from reality.
- This is largely a 2D chart-overlay feature (feasible) plus marker placement.
  Wire it against mock observations now if real Argo isn't connected yet, through
  an `ObservationSource` interface, so real Argo/glider data swaps in later.

### TIER 2 — HIGH VALUE, MODERATE EFFORT (do after Tier 1)

**5.4 Isosurfaces (extract a feature buried inside the volume).**
"Show the 20 °C surface" → render the 3D surface where temperature = the chosen
value, floating inside the block. This is the single strongest "why 3D matters"
feature — it shows a shape that cannot exist in a 2D map (the thermocline as a
warped 3D surface, a warm/cold water-mass boundary, an anomaly shell).
- Implementation: **marching cubes** over the loaded 3D scalar array for the
  chosen isovalue → a mesh; render semi-transparent, colored by depth or value.
- Add an isovalue slider so the user sweeps the surface through the range.

**5.5 Current flow lines (streamlines).**
For the currents variable, represent flow as **streamlines/arrows** seeded in the
U/V field at a chosen depth (or a few depth levels), rather than a flat colored
volume. Integrate short paths through the velocity field and draw them as lines.
This shows circulation, which colored blobs cannot.

### CROSS-CUTTING (small, high-value)

**5.6 Time-step animation.** Step/play through time steps; the field, slices, and
isosurface update while camera/slice settings persist. (PS explicitly requires
time-step animation.)

**5.7 Colorbar controls.** Palette choice, min/max range, log/linear — the PS
lists a "dynamic colorbar editor" as a core requirement. Small, cheap, expected.

---

## 6. EXPLICITLY OUT OF SCOPE (label as "future / plugin" — the PS rewards this)

Do NOT build these for the prototype — they are large research efforts and the
PS explicitly asks for an *extensible plugin architecture* for exactly this:
- **True GPU volume rendering with transfer functions** (ray-casting the whole
  volume with opacity-by-value). This is the subject of dedicated research papers
  (i4Ocean etc.) and is GPU-heavy. Cut planes + isosurfaces deliver ~80% of the
  "see inside" value at a fraction of the effort. Keep this as future work.
- Automated **eddy detection, front tracking, seeded pathline ensembles**.
- HF-radar / ADCP / mooring ingestion, ML-derived products.
State these as extensibility targets in the UI/docs — that satisfies the PS's
extensibility requirement without building them.

---

## 7. WHY THIS ANSWERS "WHAT'S EVEN 3D ABOUT IT"

After this layer, the block is no longer a decorated box — it supports the actual
oceanographer workflow: **slice into the interior at any depth/transect, probe
the full water column at any point, extract buried features as isosurfaces,
compare model against real observations, and watch it evolve over time.** Each of
those is something stacked 2D maps cannot do — the third dimension now earns its
place.

---

## 8. BUILD ORDER

1. **Interior horizontal depth slice** (make "SLICE FROM TOP" live + texture the
   cut with real data). — biggest single "now I can get inside" win.
2. **Interior depth-column probe** (full profile on click, works on cut faces).
3. **Vertical cross-section slice** (along lat/lon/transect).
4. **Model-vs-observation profile overlay** (Argo marker → obs vs model curves).
5. **Isosurface** (marching cubes + isovalue slider).
6. **Streamlines** for currents.
7. **Time animation + colorbar controls.**

Keep the app runnable after each step. Steps 1–4 are the core that transforms the
tool; 5–7 are strong additions.

---

## 9. TECHNICAL NOTES

- **Everything samples the already-loaded volume.** No new data fetching needed
  for slicing/probing/isosurfaces — index/interpolate into the lon×lat×depth
  array the app already holds.
- Slices/isosurfaces re-compute only on control change, not per frame — keep
  interaction smooth.
- Reuse the existing colormap + provenance system so interior data is labeled and
  colored consistently with the faces.
- Keep observation access behind an `ObservationSource` interface (mock now, real
  Argo/glider later) so gap #2 can ship with mock data and swap to real cleanly.
- Respect the honest-labeling discipline already in place: interior cut faces show
  REAL sampled data (label as such); anything stylized stays labeled stylized.

---

## 10. FIRST TASK

1. Review the current code: how the volume is loaded/stored, how faces are
   textured, how pin-to-inspect samples a value.
2. Explain the plan for **5.1 (live interior horizontal depth slice)** — how you'll
   sample the volume at a depth, texture the cut plane, and clip the box — with
   any assumptions flagged.
3. Implement it, run it, and confirm (a human will check) that moving the depth
   slider reveals real interior data on a horizontal cut inside the block.
4. Then proceed down the build order.

**Success for this layer:** a researcher can slice into the volume at any depth
and transect, click any interior point to read its full profile, extract an
isosurface of a chosen value, and compare an Argo profile against the model — all
on the real GLORYS data already being served.
