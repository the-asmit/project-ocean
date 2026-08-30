# Real-data spike — Fix 1 (terrain blockiness) & Fix 2 (neon shelf ribbon)

**Date:** 2026-08-30 · builds on [`FINDINGS.md`](./FINDINGS.md) · `spike/` untouched.

Raymarch core (ray/box, compositing loop, early-out, `transfer()`, dither,
camera, fog, ±120 domain) unchanged. Everything below is additive.

---

## Root cause I found first (not in the brief, but Fix 1 is impossible without it)

The adapter scaled the terrain by `maxDepthM = 454 m` — the depth extent of the
**temperature** data. Real bathymetry in the coastal tile reaches **4183 m**, so:

> **65 % of the seafloor was clamped to a dead-flat plane at the box floor.**
> Only 13 % of cells had any relief at all. The "shelf" was a vertical cliff
> between the flat plane and a flat shelf — which is exactly the "shark teeth".

Adding noise on top of that would have been decoration over a broken mesh, and
the brief's own requirement ("the real basin/shelf/ridge structure must still be
recognizable underneath the noise") could not have been met — there was no
structure to recognise. So the mapping is fixed first.

**One shared `depth_to_ynorm()` in `adapt.py`** now drives the terrain mesh, the
seafloor height texture *and* the depth LUT, so water and seafloor stay
registered:

```
ynorm(m) = (m / bathy_max_m) ** DEPTH_CURVE      # DEPTH_CURVE = 0.42
world_y  = -6 * ynorm
```

`DEPTH_CURVE < 1` is a depth-dependent vertical exaggeration — it stretches the
shallow shelf and compresses the abyssal plain so both are legible at once. It is
a **monotonic, invertible transform of the depth axis**, standard in bathymetric
visualisation. It does not alter, reorder or invent any sounding; every real
value keeps its exact relative position. `DEPTH_CURVE = 1.0` gives a linear axis.

Because the box now spans the full bathymetric range while `thetao` stops at
454 m, the field texture gained **one extra all-invalid guard row** and the LUT
saturates into it below 454 m. The shader's existing `.g < 0.5 → continue` then
masks "no temperature data here" **with zero added shader code**.

Result: **seafloor flat-at-box-floor 65 % → 0 %.**

---

## Fix 1 — terrain blockiness

Three layers, done together as asked:

| layer | what | where |
|-------|------|-------|
| depth mapping | full real bathymetric range (above) | `adapt.py` |
| **bicubic upsampling** | Catmull-Rom through every real sounding, C1-continuous; mesh 360² → **512²** quads | `Bathymetry.jsx` (mesh), `adapt.py` (512² floor-mask texture) |
| **synthetic detail** | zero-mean fBm + ridged octaves, wavelengths 0.9–11 world units (at/below the 3.9-unit real grid spacing), tapered to zero over land and in the surf zone | `seafloorDetail.js` |

Disclosure (P3): the module header spells out that it is fabricated and why; the
mesh keeps its **colour tint driven by the real depth, not the roughened one**;
and the HUD carries a permanent amber `SOURCE:` band naming the synthetic layer,
its amplitude and the depth-axis exaggeration. `?detail=0` removes it entirely.

### Honest measurement of the noise layer

I pixel-diffed the same frame with the layer on and off (ignoring HUD regions):

| synthetic amplitude | pixels changed >6/765 | verdict |
|---|---|---|
| 0.05 world units (my first pick) | **0.37 %** | **invisible — a no-op** |
| 0.14 world units (shipped) | 5.94 % | subtle but real |
| 0.56 world units (4× stress) | 36 % | visible, still not spiky |

So my initial amplitude did nothing and I only found that by measuring. Shipped
value is 0.14 (~27 m on the shelf, ~190 m on the abyssal plain — depth-dependent
because the axis is non-linear).

**The blockiness fix is overwhelmingly the depth mapping + bicubic, not the
noise.** Before→after at the same camera changes 96 % of pixels (mean Δ 59.8);
the noise accounts for 5.9 % of that. Do not credit the noise with the fix.

---

## Fix 2 — neon-cyan shelf ribbon

`REAL-DATA DELTA [5]` in `VolumeRaymarch.jsx`, ~4 lines. `floorY` was already
being sampled for the seafloor mask; it is now read unconditionally and reused:

```glsl
float thickness = clamp((0.0 - floorY) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0);
float dScale    = mix(uThinScale, 1.0, smoothstep(0.0, uThickRef, thickness));
float a         = 1.0 - exp(-uDensity * dScale * dt);   // was uDensity * dt
```

A shelf column is only tens of metres thick, but a near-horizontal ray can cross
tens of kilometres of it, and shelf water is near-isothermal — so a fixed density
accumulated one saturated colour over that whole path. Scaling density by the
water actually standing at that x/z makes thin columns translucent and leaves
deep columns untouched. Defaults `uThinScale = 0.12`, `uThickRef = 0.42`; both
are live in the leva panel, and `?thin=1` restores the old behaviour.

Measured over the broad <50 m shelf between India and Sri Lanka (the geometry
that actually produces the ribbon): **9.4 % of pixels changed**, the saturated
warm band visibly dims. See `ab-ribbon-OFF-fixeddensity.png` vs
`ab-ribbon-ON-thicknessaware.png`.

---

## Screenshots

| file | what |
|------|------|
| `before-shelf.png` / `after-shelf.png` | **same camera**, across the shelf break — the main comparison |
| `before-scene.png` / `after-scene.png` | **same camera**, default first-person full scene |
| `ab-ribbon-OFF-fixeddensity.png` / `ab-ribbon-ON-thicknessaware.png` | Fix 2 isolated over the shallow shelf |
| `ab-detail-OFF-realonly.png` / `ab-detail-ON-synthetic.png` | Fix 1's synthetic layer isolated (water near-transparent) |
| `ab-detail-4x-stress.png` | synthetic layer at 4× — the "is it obviously fake?" test |

---

## Tradeoffs and things that got worse — read this

1. **The depth-axis change is a real editorial decision, not a bug fix.** The
   vertical axis is now non-linearly exaggerated. Shelf relief is overstated
   relative to abyssal relief. It is labelled in the HUD and tunable
   (`DEPTH_CURVE` in `adapt.py`), but the real app must decide this deliberately
   and probably expose it as a user control with a legend.

2. **Cameras from the previous turn no longer frame the same thing.** Moving the
   seafloor changed the scene. The old `coast` vantage now sits in empty water;
   before/after are only comparable at the two vantages I kept.

3. **The synthetic detail is nearly invisible at normal viewing distance, and
   that is arguably correct.** The terrain is 240 world units across with ~6
   units of relief, so from any first-person camera it reads as a distant
   horizon. Sub-grid roughness only matters within a few units of the floor —
   a range this camera rig never uses. It does soften the terrain *silhouette*,
   which is where the teeth were most obvious, so it earns its place; but if you
   want it to do visible work you would need close-range cameras.

4. **Does it look worse at the shelf break?** Honestly: **no, but only because
   the amplitude is tapered.** The taper (`detailAmplitude`) fades the noise to
   zero over land and across the top ~0.35 world units, so the coastline stays
   crisp. Without that taper, at 4× amplitude the shallow shelf does get a
   slightly "crinkled tinfoil" look where the water is thin — the roughness
   becomes a large fraction of the water column. The shipped 0.14 with taper is
   below that threshold at every angle I checked. If you raise `?detail=`
   past ~2 you will start to see it on the shelf.

5. **512² mesh costs ~2 fps** vs 256² (30.8 → 28.8 on this machine). `?seg=256`
   backs it off. Page load including mesh build is 647 ms.

6. **Land is still a hard grey step at the coastline.** The bicubic smooths the
   *depth*, but land/water is a binary mask at 1/12°, so the shoreline is still
   visibly 9 km-blocky. Fixing that needs real coastline vector data or
   higher-res bathymetry — out of scope here and unchanged by these fixes.

---

## Verification

- **No console errors** on any config (`?tile=coastal`, `?tile=open`,
  `?detail=0`, `?thin=1`, `?clip=`, `?seg=`).
- **One FPS reading at defaults**, 1440×810, continuous orbit, coastal tile:
  **24.9 fps avg**, GPU `ANGLE (AMD Radeon 740M, D3D11)`.
  Caveat carried over from `FINDINGS.md`: this machine has been running
  degraded — the *unchanged* `spike/` measured ~28 fps against its own 60 fps
  baseline in the same session. Treat 24.9 as a lower bound, judge on yours.
