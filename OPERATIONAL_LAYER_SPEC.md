# Ocean-Viz — Operational Layer Spec (turning the viewer into a decision tool)

> Paste into the Claude Code session that owns the Ocean-Viz frontend/backend
> (the build already rendering real GLORYS12V1 as a 3D block with slicing,
> probing, transect, and currents). This spec ADDS the operational, decision-
> relevant layer the SIH PS asks for — hazard assessment, search-and-rescue,
> fisheries, monitoring. **It does not change the existing renderer.** Every
> feature here is a computation on the temperature/velocity volume already
> loaded, rendered as a layer in the existing 3D scene.
>
> This spec has been researched for feasibility. The computations are simple
> depth-axis integrals (safe). The ONE feature with an implementation trap
> (isosurfaces) has the trap explicitly flagged in §6 — read it before building
> that feature.

---

## 1. WHY THIS LAYER EXISTS (the gap it closes)

The current tool lets a user *look at* the 3D ocean — slice, probe, see fields.
But SIH 26067 asks for tools that support **rapid understanding of complex 3D
phenomena for operational decision-making**: hazard assessment, search-and-
rescue, fishery advisories, climate monitoring.

A forecaster doesn't need raw temperature — they need **derived, decision-
relevant quantities**: "is there enough ocean heat here to intensify a cyclone?",
"where will a drifting object go?", "where's the thermocline the fish follow?",
"what's anomalous right now?". This layer computes those quantities from the data
already loaded and renders them in the existing 3D scene.

Each feature below is grounded in how INCOIS / operational oceanography actually
works, with the real formulas and India-specific thresholds.

---

## 2. RENDERING PRINCIPLE (important — do not make flat 2D panels)

These derived quantities are **visually appealing ONLY when rendered as layers in
the existing 3D block**, not as separate flat 2D charts:
- Surfaces (D26, thermocline) — render as **warped 3D surfaces floating inside
  the semi-transparent block** — a rippling sheet at the depth of the isotherm.
  This is the most striking 3D visual in the whole tool.
- Fields (TCHP, anomaly) — render as a **colored layer on the block's top / a
  horizontal plane**, with threshold contours.
- Trajectories (drift) — render as **animated paths through the 3D current
  field**.
- Only the model-vs-observation comparison is a 2D chart (a profile overlay).

Reuse the existing colormap/provenance/labeling system. Keep the honest-labeling
discipline (real data vs derived/stylized).

**Add these features as TOGGLES / LAYERS on the existing single page — do NOT add
new pages or view modes.** Each operational quantity (D26 surface, TCHP field,
drift path, anomaly, isosurface) should be a layer the user turns on/off on the
current 3D block, exactly like the existing variable switching. This keeps the
working build intact, costs almost nothing architecturally, and avoids clutter by
letting the user show only what they want. Do not restructure the app. If, after
the features exist, one screen genuinely feels cramped, grouping can be revisited
then — not speculatively now.

---

## 3. FEATURE 1 (FLAGSHIP) — Tropical Cyclone Heat Potential + D26 surface

**Use case:** cyclone hazard assessment. This is THE operational ocean parameter
for cyclone intensification — it matters more than sea surface temperature.
INCOIS/NCMRWF compute it operationally, daily, for the North Indian Ocean.

**The science (use these exact definitions):**
- **D26 = depth of the 26 °C isotherm** — the depth at which temperature crosses
  26 °C going down. This is the thickness of the warm layer that fuels cyclones.
- **TCHP / Ocean Heat Content** = integrated heat in water warmer than 26 °C,
  from surface down to D26:

  `TCHP(x,y) = ρ · c_p · ∫[0 → D26] (T(z) − 26) dz`

  with **ρ ≈ 1026 kg/m³**, **c_p ≈ 3990 J/(kg·°C)**. Only water where T ≥ 26 °C
  contributes; where the surface is cooler than 26 °C, TCHP = 0. Report in
  **kJ/cm²** (the operational unit).

  *Note on constants:* these are standard values for the **direct depth-integral**
  method (the appropriate method when you have full temperature profiles, which we
  do). Different sources use slightly different constants/reference conventions
  (e.g. NOAA's altimetry method references 20 °C), so the **absolute kJ/cm² may
  differ slightly from a specific published product** — but the **spatial pattern**
  (where TCHP is high vs low, and whether it clears the threshold) is robust. Do
  not present our absolute number as matching any specific INCOIS product to the
  decimal; present it as a physically-grounded estimate.

**India-specific threshold to display (this is the operational payoff):**
In the Bay of Bengal, **roughly ≥ 40 kJ/cm² of upper-ocean heat content is the
commonly-cited threshold associated with cyclone intensification**, and TCHP in
the region is well-documented to correlate with cyclone intensity. Mark the
~40 kJ/cm² contour — regions above it are cyclone-intensification-favorable.

*Before putting a specific citation, exact threshold, or correlation coefficient
on a slide, verify it against the current INCOIS/IMD literature* — the ~40 kJ/cm²
figure is sound and widely used, but the precise number and source should be
confirmed by the team rather than quoted from this spec.

**Implementation (safe — pure depth-axis computation on the loaded T volume):**
- D26: for each (lon,lat) column, find where T crosses 26 °C (linear-interpolate
  between the two bracketing depth levels). A simple loop / vectorized `numpy`
  op over the array you already have.
- TCHP: integrate `(T − 26)` over depth from 0 to D26, clip negatives to 0,
  multiply by ρ·c_p, convert to kJ/cm². Standard `np.trapz`/xarray integral.
- No new data, no new rendering engine — arithmetic on the temperature array.

**Render:**
- **D26 as a warped 3D surface** inside the block (the flagship visual — a sheet
  that dips deep in warm pools, rises in cool areas). *Reuse the existing
  seafloor-surface method:* you already build the seafloor as a displaced surface
  mesh from a per-(lon,lat) depth value — D26 is the exact same technique, just
  using the D26 depth as the height instead of the bathymetry. Don't reinvent it.
- **TCHP as a colored top-surface field** with the **~40 kJ/cm² contour** drawn
  and labeled ("cyclone-intensification threshold").
- Cursor readout: show TCHP value + "above/below intensification threshold".

**Demo line this enables:** *"This warm pool exceeds 40 kJ/cm² and the warm layer
is 120 m deep here — a cyclone crossing it would intensify. A 2D SST map can't
show the depth; our 3D tool can."*

---

## 4. FEATURE 2 — Thermocline depth + Anomaly view

**Use case:** fisheries advisories (thermocline) + climate/event monitoring
(anomaly). Both are trivial computations that also make bland fields look better.

**Thermocline depth** (fish aggregate along it; also a stratification indicator):
- Two accepted definitions — implement the gradient one (more physical):
  **Z_grad = depth of maximum vertical temperature gradient** (|dT/dz| max per
  column). (Alternative: Z20 = depth of 20 °C isotherm — same method as D26.)
- Render as another **warped 3D surface** in the block (like D26).

**Anomaly view** (surfaces what's *unusual* — what operations act on):
- Anomaly = field value − reference mean. For the prototype, reference = the
  spatial mean of the loaded tile at that depth (or a stored climatology if
  available later). `value − mean`.
- Render as a diverging colormap (blue negative / red positive) on the slice /
  block face. **This also fixes bland-looking salinity** — anomalies are high-
  contrast by nature, so a near-uniform field becomes legible.

Both are one-line array ops on data already loaded. Safe.

---

## 5. FEATURE 3 — Drift trajectory (search-and-rescue)

**Use case:** SAR — "a person/object went overboard here; where does the current
carry them?"

**Implementation (extension of the existing streamlines — same operation):**
- User drops a marker at a (lon,lat), optionally a depth.
- Advect the point forward through the u/v velocity field over time: at each
  timestep, sample u,v at the point's position, move it by (u·dt, v·dt), repeat.
  (This is particle advection — exactly what the existing streamline code does;
  reuse it, just for a single seeded point over a time horizon.)
- Render the predicted path as an **animated line through the 3D current field**,
  with time markers (e.g. hourly).

Feasible; moderate effort; builds on existing flow code. If multiple GLORYS
timesteps are loaded, advect through the evolving field; if one timestep, advect
through the static field (label it as such).

---

## 6. FEATURE 4 — Isosurfaces (the highest-wow 3D visual) — READ THE TRAP

**Use case:** the single most "why-3D-matters" visual — extract the 3D surface
where a variable equals a chosen value (e.g. the 26 °C surface = D26, or a 20 °C
surface). A shape that cannot exist on a 2D map. Also doubles as the D26 render.

**⚠️ IMPLEMENTATION TRAP — read before building:**
Three.js ships a `MarchingCubes` addon (`three/addons/objects/MarchingCubes.js`),
**but it is designed for metaballs/blobs** (its API is `addBall`, `addPlane`) and
is **NOT a drop-in for extracting an isosurface from a gridded scalar array.**
Do NOT try to feed the GLORYS temperature array into the built-in `MarchingCubes`
addon — you will fight the wrong API for hours.

**Correct approach:** use a **standalone marching-cubes function that takes a 3D
scalar array + an isovalue and returns triangle vertices** (there are several
small, proven JS implementations, e.g. the misc3d-derived one). Feed it your
temperature volume + the isovalue (26 °C), get back a mesh, render it as a normal
semi-transparent `THREE.Mesh` in the scene. Optionally color the isosurface by a
**second variable** (e.g. the 26 °C surface colored by depth) — this is a
standard, high-value technique (per VAPOR).

- Add an **isovalue slider** so the user sweeps the surface through the range.
- Render semi-transparent so it reads as a surface floating inside the block.

Feasible once you use the right (scalar-field) marching-cubes function, not the
metaball addon. That distinction is the whole difficulty.

---

## 7. FEATURE 5 — Model vs Observation comparison (PS's #1 stated gap)

**Use case:** validation — the PS's headline requirement ("no unified display of
Argo/glider profiles alongside model fields"). A core oceanographer workflow task
is "compare recently measured data against model data."

**Implementation (a 2D chart overlay — easy):**
- Click an Argo float (mock now, real later via the `ObservationSource`
  interface) — plot its **measured** temperature/salinity depth profile.
- **Overlay the MODEL profile** at the same lat/lon/time on the same axes — two
  curves, observation vs model — so the forecaster sees where the model matches
  or diverges from reality.
- Label which is model (GLORYS) and which is observation (Argo).

Works with mock Argo now; swaps to real Argo later with no chart change.

---

## 8. EXPLICITLY OUT OF SCOPE (do NOT build — label as future/plugin)

Researched and deliberately excluded — these are research-grade traps:
- **Direct GPU volume rendering with transfer functions** — heavy ray-casting;
  isosurfaces give the quantitative value far more cheaply. Skip.
- **Automated eddy detection / tracking** — an open research problem (needs
  SSH + velocity + detection algorithms). Let users *see* eddies in streamlines;
  don't auto-detect. Skip.
- **Neural-network TCHP from satellite SSHA** — the "advanced" INCOIS method; our
  direct depth-integral from the GLORYS temperature volume is simpler, honest,
  and valid. Do NOT build the NN version.

The PS explicitly rewards an extensible plugin architecture — name these as
future extensions in the UI/docs to satisfy that requirement without building
them.

---

## 9. BUILD ORDER (each is independently shippable; stop for a look after each)

1. **D26 + TCHP** (flagship — arithmetic; render D26 as a 3D surface + TCHP field
   with the 40 kJ/cm² threshold). Highest value, near-zero risk. Do first.
2. **Anomaly view** (one-line op; also fixes bland fields).
3. **Model-vs-Argo profile overlay** (PS's #1 gap; 2D chart).
4. **Thermocline-depth surface** (same method as D26).
5. **Drift trajectory** (extends existing streamlines).
6. **Isosurface with isovalue slider** (highest wow; MIND THE §6 TRAP — use a
   scalar-field marching-cubes function, NOT the metaball addon).

Items 1–3 are the operational core and are all low-risk. 4–6 are strong additions
(6 is the wow visual but the one with a trap).

---

## 10. FIRST TASK

1. Review how the temperature volume is stored and how existing fields are
   rendered on the block.
2. Explain your plan for **Feature 1 (D26 + TCHP)** — how you'll compute D26 and
   the heat integral from the array, and how you'll render D26 as a 3D surface and
   TCHP as a threshold field — flagging any assumptions.
3. Implement it, run it, and confirm (a human will check) that a warm region shows
   a deep D26 surface and a TCHP field with the 40 kJ/cm² contour.
4. Proceed down the build order.

**Success for this layer:** a forecaster can open the tool and answer real
questions — is this region cyclone-favorable (TCHP vs 40 kJ/cm²)? how deep is the
warm layer (D26 surface)? where will a drifting object go (drift path)? does the
model match the Argo observation? — all computed from the GLORYS data already
being served, rendered in the existing 3D scene.
