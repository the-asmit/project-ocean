# Real-data spike — findings

**Date:** 2026-08-30
Real GLORYS `thetao` (2020-01-01) + GLORYS static bathymetry, two Bay-of-Bengal
tiles, pushed through the proven `spike/` raymarch pipeline.

> The raw-dataset inspection report is in [`INSPECTION.md`](./INSPECTION.md) —
> read that first. This doc is what happened when the real data hit the shader.
>
> **Superseded in part:** concerns #1 (blockiness) and #2 (neon shelf ribbon)
> below were addressed on 2026-08-30 — see [`FIXES.md`](./FIXES.md). That work
> also uncovered a terrain-scaling bug that had flattened 65 % of the seafloor.
> Screenshots referenced in *this* file are from the pre-fix build.

## Does it still look continuous / correct?

**Yes.** See `screenshots/`.

- **`open` tile (deep ocean, 0 % NaN)** — `screenshots/open-0.png`. Indistinguishable
  in quality from the synthetic spike: a smooth warm-surface → cold-deep gradient,
  **no vertical banding despite the 31 wildly non-uniform depth levels**. The
  depth-remap LUT does its job invisibly.
- **`coastal` tile (Sri Lanka + shelf, 29 % NaN)** — `screenshots/coastal-0.png`,
  `coastal-3-down.png`. The volume correctly **pools on the shelf and stops at the
  coastline**; land renders as grey terrain with no temperature colour bleeding
  onto or past it. Thermocline structure and the shelf/deep-water contrast are
  visible and physically plausible.
- **Depth-clip cross-section** still works on real data (`coastal-clip.png`):
  clip at −2.2 removes the warm surface layer and exposes the ~15–20 °C
  thermocline water.

## What the shader delta actually was

Per your "separate shader file" call, `spike/` is untouched;
`spike-real-data/src/VolumeRaymarch.jsx` is a copy with **~9 added lines, all in
the field-sampling preamble** (marked `REAL-DATA DELTA`). The ray/box test, step
loop, Beer–Lambert compositing, early-out, `transfer()`, dither, camera, fog and
±120 domain are **byte-for-byte identical**:

| # | change | why |
|---|--------|-----|
| 1 | `uField` R8 → **RG8** — `.r` = temp, `.g` = validity | need a per-voxel valid/invalid flag |
| 2 | `+ uniform float uLUT[128]` | non-uniform GLORYS depth levels |
| 3 | linear world-Y → field row goes through `uLUT` (lerp) | put each level at its true depth |
| 4 | `if (uMaskInvalid && s.g < 0.5) continue;` | skip land / below-seafloor voxels |

The **land/NaN handling** is split CPU + GPU:
- adapter fills invalid `.r` cells by iterative nearest-valid dilation, so
  trilinear filtering near a coast blends valid↔plausible, never valid↔garbage;
- adapter writes a true `.g` validity mask (0/1), **not** dilated;
- shader skips `.g < 0.5`. Toggle "mask land / NaN" off (`?nanmask=0`) to see the
  blocky below-seafloor cells it removes at the shelf edge
  (`coastal-nanmask-off.png` vs `coastal-0.png`).

The **depth LUT** started as an R32F texture sampled per march step; that
dependent float-texture fetch measured as ~35 % of frame time on the target iGPU,
so it moved to a `uniform float[128]` array (adapter emits it inline in
`meta.json`). Recommend the real app do the same.

## Things real data revealed that synthetic hid

1. **Everything is blocky at native 1/12° resolution.** The tile is 5°×5° = **61×61
   cells** (~9 km). Trilinear filtering keeps the *volume* interior smooth, but
   the **shelf break, the coastline, and the terrain mesh all show the grid**
   (`coastal-3-down.png`). The synthetic spike's 128³ field + 400-segment noise
   terrain hid this completely. This is not a bug — GLORYS is just this coarse.
   For the real app: the volume can stay coarse (filtering saves it), but the
   **bathymetry needs a finer source** (GEBCO 15″) and proper terrain LOD, exactly
   as the first spike's scale note said.

2. **Shallow-shelf water renders as a bright neon-cyan ribbon.** A shallow column
   is short, so the ray accumulates near-surface temperature over its whole length
   before the seafloor mask stops it → saturated mid-ramp colour. Physically
   defensible (shelf water *is* warm top-to-bottom) but visually loud. The real
   app will want depth- or thickness-aware opacity, or a transfer function that
   isn't a raw temperature ramp.

3. **The brief's box (10–15 °N, 85–90 °E) has zero land and zero seafloor
   interaction** — it's all 3000 m+ open ocean and we only render the top 454 m.
   Had to fetch a second coastal tile to exercise the risky paths. Lesson for the
   real app: most of the Bay of Bengal interior is the easy case; **all the hard
   cases are within ~1° of the coast**, and that's a small fraction of the domain
   — worth masking/handling as a special region rather than paying for it
   everywhere.

4. **~30× vertical exaggeration.** 0–454 m of water mapped into the same y-box as
   the synthetic ±6 units, against a 550 km-wide tile. Looks fine, but the number
   should be a deliberate, labelled control in the real app, not a side effect of
   reusing the spike's box.

5. **Depth only goes to 454 m** (our 500 m request clipped to level 31). Fine for
   a thermocline demo; the real app pulling the full column hits 50 levels to
   5500 m and the LUT / memory maths from the first spike's scale note.

6. **`thetao` is packed `int16` (scale/offset), fill = `NaN` after decode, and the
   bathy `mask` matches `isfinite(thetao)` to 100 %.** No nasty surprises — units
   are °C, land is unambiguous, grids align. The ingest is clean.

## Honest status

- **Runs with zero console errors** on all configs (`?tile=coastal`,
  `?tile=open`, `?nanmask=0`, `?clip=`).
- **Performance not benchmarked** (per your instruction). Note: this session's
  machine was running the *unchanged* synthetic spike at ~28 fps vs its previous
  60 fps baseline, so it was thermally/environmentally degraded — judge real
  numbers on your own hardware. The one real-data-specific cost identified and
  removed was the LUT texture fetch (above).
- Nothing was silently downgraded: the LUT, the validity mask, and the coastal
  test tile are all real and all exercised.
