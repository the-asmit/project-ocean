# Real-data inspection report (P7 — structure verified, not guessed)

**Date:** 2026-08-30
**Toolbox:** `copernicusmarine` 2.4.1 (Python 3.12 via `uv`, inside WSL Ubuntu)
**Credentials:** read from `CMEMS_USERNAME` / `CMEMS_PASSWORD` in a local `.env`
(gitignored — see `.env.example`). Login worked.

## Datasets actually fetched

| what | dataset_id | notes |
|------|-----------|-------|
| temperature | `cmems_mod_glo_phy_my_0.083deg_P1D-m` | var `thetao`, 2020-01-01, depth 0–500 m |
| bathymetry + mask | `cmems_mod_glo_phy_my_0.083deg_static` **part `bathy`** | vars `deptho`, `mask`, `deptho_lev` |

> ⚠️ The `dataset_id` in the brief — `cmems_mod_glo_phy_my_0.083deg_staticbathy` —
> **does not exist**. `copernicusmarine describe` shows the real one is
> `…_0.083deg_static`, and bathymetry is the `bathy` *part* of it.

### Two tiles, not one — and why

The brief's box (**10–15 °N, 85–90 °E**) turned out to be **entirely deep open
ocean**: seafloor 2700–3500 m, **0 % NaN**, and since we only pull 0–500 m the
seafloor is nowhere near the rendered volume. That box **cannot exercise** the two
things this spike exists to de-risk — land/coastline NaN bleed, and the field
terminating on a shallow seafloor.

So I fetched a **second tile** (`*_coastal.nc`): **6–11 °N, 79.5–84.5 °E** —
Sri Lanka + its shelf + open Bay. This one has land, a shelf break, water from
7 m to 4183 m deep, and **29 % NaN**. All the interesting cases below come from it.

---

## thetao (temperature)

| property | value |
|---|---|
| **dimension order** | `(time, depth, latitude, longitude)` — time first, lon last |
| shape (this tile) | `(1, 31, 61, 61)` |
| **latitude** | **ascending** (south → north), uniform 1/12° (0.08333°) |
| **longitude** | **ascending** (west → east), uniform 1/12° |
| **depth** | **ascending**, `positive: down`, **NON-UNIFORM** (see below) |
| units | **°C** (`units: degrees_C`, `unit_long: Degrees Celsius`) — *not* Kelvin |
| on-disk encoding | `int16`, `scale_factor 7.324e-4`, `add_offset 21.0`, `_FillValue -32767` |
| in-memory | `float64`, fill already decoded to **`NaN`** by xarray |
| value range (open-ocean tile) | 9.75 – 29.14 °C |
| value range (coastal tile) | 9.69 – 29.97 °C |
| **NaN — open-ocean tile** | **0.0 %** |
| **NaN — coastal tile** | **29.2 %** (21.6 % at surface = land; rises to 35 % at 454 m = land + below-seafloor on the shelf) |

`NaN` is the **only** missing-data signal in the temperature file — it means *land*
**and** *below-seafloor*, undifferentiated. Cross-checked against the bathy
`mask`: `isfinite(thetao) == (mask == 1)` agreement is **100.00 %**.

### Depth levels — the 31 values (metres)

```
 0: 0.494    8: 11.405   16: 40.344   24: 155.851
 1: 1.541    9: 13.467   17: 47.374   25: 186.126
 2: 2.646   10: 15.810   18: 55.764   26: 222.475
 3: 3.819   11: 18.496   19: 65.807   27: 266.040
 4: 5.078   12: 21.599   20: 77.854   28: 318.127
 5: 6.441   13: 25.211   21: 92.326   29: 380.213
 6: 7.930   14: 29.445   22: 109.729  30: 453.938
 7: 9.573   15: 34.434   23: 130.666
```

Spacing goes from **1.05 m** (level 0→1) to **73.7 m** (level 29→30) — a **70×**
ratio. This is the non-uniform-Z problem the previous spike flagged, and it is
severe. Naïvely uploading these 31 slabs into an evenly-spaced 3D texture would
put the thermocline (≈50–150 m) at the wrong height and squash it.

`thetao` only reaches **453.9 m** (level 31 would be 541 m, past our 500 m cap).

### A real vertical profile (coastal-tile centre)

```
   0–55 m : ~28.0 °C  (near-isothermal mixed layer, faint 55 m barrier-layer bump to 28.7)
  55–130 m: 28.7 → 19.0 °C  (sharp thermocline)
 130–454 m: 19.0 → 10.3 °C  (gradual)
```

Physically clean. No unit surprises, no offset.

---

## deptho / mask (bathymetry)

| property | value |
|---|---|
| `deptho` dims | `(latitude, longitude)` — 2-D |
| `deptho` units / sign | **metres, positive DOWN** (`sea_floor_depth_below_geoid`) |
| `deptho` land value | **`NaN`** (`_FillValue 9.969e36`, decoded); 0 raw fill values leaked through |
| `deptho` range (coastal tile) | 7 – 4183 m over water |
| `mask` dims | `(depth[50], latitude, longitude)`, `int8`, values `{0,1}`, **1 = sea** |
| `deptho_lev` | `(lat, lon)` model-level index at seafloor (42–44 in open-ocean tile) |
| lat/lon grid | **identical** to thetao (same 61×61, same values) |
| bathy file `depth` coord | 50 levels to 5727 m (full GLORYS column; first 31 == thetao's) |

`deptho` is on the **same horizontal grid** as `thetao`, land = NaN, positive down.
The land footprint (804 surface cells) matches thetao's surface NaN count exactly.

---

## What this means for the pipeline (proposed — awaiting your OK before I touch rendering)

1. **Non-uniform depth → 1-D remap LUT.** Build a 256-entry LUT
   `normalized-depth → normalized-texture-row` from the 31 level values; sample it
   in the shader to convert the linear world-Y coord into the correct field-texture
   row. **This needs a shader edit** (a `sampler2D uDepthLUT` + one remap line
   before the field sample). Alternative with **zero shader change**: resample the
   column to uniform spacing CPU-side when building the texture — for a 0–454 m /
   31-level tile this loses nothing, but it does *not* de-risk the LUT path the
   real (0–5500 m, 50-level) app will need.

2. **NaN / land → validity channel.** Switch the field texture **R8 → RG8**:
   R = normalised temp, G = validity (0/1). Fill invalid R cells with the nearest
   valid value (3-D dilation) so trilinear filtering near coastlines blends
   valid↔plausible, never valid↔garbage; then in-shader `if (validity < 0.5)
   continue;`. **Also a shader edit** (sample `.rg`, one `if`).

3. **Bathymetry heightmap** from `deptho`: land + below-454 m clamped so the
   existing seafloor-mask logic keeps working unchanged.

4. **Domain / range**: map lon→x, lat→z (both ascending), depth 0–454 m → y 0…−6.
   That's ~**30× vertical exaggeration** at this tile size — high but normal for
   basin-scale ocean viz; flagging it. Set `TEMP_MIN/MAX ≈ 8/30 °C` (constants
   only) so the real 9.7–30 °C range spreads across the full colour ramp.

### The one thing I need you to decide

The brief says both *"implement the depth-remap LUT / NaN handling in-shader"* **and**
*"do not rewrite the shader"*. Those collide. My reading: the raymarch **algorithm**
(ray-box, step loop, Beer–Lambert compositing, early-out, transfer function,
dither, camera, fog, ±120 domain) stays **byte-for-byte identical**; the only
additions are **(a)** a depth-LUT sampler + one remap line, and **(b)** an RG
sample + one validity `if`. ~4 new lines, all in the field-sampling preamble,
nothing touched in the marching/compositing core.

Confirm that's acceptable, or tell me to keep the shader 100 % untouched and do
the uniform-resample + no-mask route (which won't fully de-risk the real app).
