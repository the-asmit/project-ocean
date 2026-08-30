# Raymarching spike — findings

**Date:** 2026-08-30
**Question:** Can Three.js / WebGL2 render a 3D scalar field (ocean temperature) as a
*continuous* volumetric gradient inside a real bathymetry shape, without it looking
like a stack of flat discrete slabs?

## Verdict: YES — the approach works. Proceed with Three.js/WebGL2.

The continuous look is achieved and it is not close. No visible slab boundaries, no
horizontal banding, smooth blend through depth from every camera angle. The
technical call to use Three.js/WebGL2 over Babylon/WebGPU holds up: this was a
shader problem and the shader problem is solved with standard, well-supported
WebGL2 features (`sampler3D` / `Data3DTexture`, GLSL3).

### Framing (reworked after first pass, then tuned)

The first pass framed the volume as a bounded diorama viewed from outside (visible
wireframe box, edges in frame). That's replaced with a **first-person** frame:
wireframe removed, the domain blown up to ±120 (24× wider) so its edges never
enter the frustum from any angle, camera dropped low (y ≈ −1) and close, angled
across the seafloor, and `FogExp2` in the background colour so terrain dissolves
into haze instead of hard-cutting to black. The raymarch **shader is byte-for-byte
unchanged** — only domain scale, camera, fog and synthetic-field tuning moved.

**Tuning pass (openness).** The first first-person attempt read as "drowning in
solid colour fog". Fixed by pushing three knobs together (`screenshots/fp-*.png`):

| knob | was | now | effect |
|------|-----|-----|--------|
| volume `density` (extinction/unit) | 0.09 | **0.022** | colour reads as tinted *clear* water, not a wall; deep/cold water stays near-black |
| `FogExp2` density | 0.032 | **0.011** | ~3× the clear-visibility distance — fog now only does the far falloff (~50% at ~63 u, opaque past ~160 u), the near/mid view stays crisp |
| march `steps` | 224 | **192** | lower `density` means little early-ray-termination, so most rays run the full count; 192 is the cheapest count with no visible banding at this density |

Result: dark, open scene with visible negative space, terrain structure legible
well into the distance, and the warm-surface→cool-depths gradient concentrated as
a horizon glow band rather than filling every pixel. All three remain live in the
leva panel (`density`, `march steps`) and via `?density=` / `?fog=` / `?steps=`.

### What made it continuous (all three matter)

1. **Trilinear-filtered `Data3DTexture`.** `LinearFilter` on an R8 3D texture is
   guaranteed on all WebGL2 implementations and interpolates smoothly between the
   64×40×64 grid samples. This alone removes the "slabs" — there are no discrete
   layers, the texture fetch is continuous in 3D.
2. **Beer–Lambert alpha compositing** (`a = 1 - exp(-density * dt)`) instead of a
   fixed per-step alpha. This makes the accumulated opacity independent of step
   size, so lowering the step count changes cost and fine detail but *not* the
   overall look or brightness — no "it got darker when I capped the steps".
3. **Blue-noise dithered ray-start offset.** Without it, low step counts show
   faint stepping on the depth gradient where every ray crosses the same sample
   planes; the per-pixel hash offset trades that structured banding for
   unstructured film-grain the eye reads as smooth — which is what lets us drop
   the step count. Toggle "dither ray start" in the panel to compare.

### Bathymetry masking

The bounding volume respects the seafloor. The seafloor heightfield is baked to a
2D `DataTexture`; the shader samples it at each step's x/z and discards samples
below that height. In the first-person frame the volume visibly hugs the terrain —
it pools in the valleys and thins over the ridges (see `screenshots/fp-4-look-down.png`).

Caveat, now more visible in first-person than it was top-down: the volume uses
`depthTest: false` and relies only on the height mask, not the real depth buffer.
A near ridge that should fully block the volume behind it instead lets a little
volume haze bleed past its silhouette, because the mask only removes *sub-seafloor*
samples, not samples that are above a *distant* seafloor but behind a *near* one.
It reads as slightly too much haze near terrain crests. The real fix is ~20 lines:
render bathymetry to a depth target first, sample it in the march loop, clamp the
ray's exit `t`. Deliberately left out to keep the shader untouched for this spike.

### Depth-clip cross-section

Works (`?clip=` param, or the "depth clip (Y)" slider). Cutting the volume at a
chosen world-Y removes everything above it and shows the internal structure below.
In first-person the region *above* the cut is empty (black) — it's a diagnostic
cross-section tool, not a hero view. The cut is soft rather than a crisp plane
(low density + front-to-back accumulation from the clip height down); boosting the
first post-clip sample's opacity would give a hard face.

## Measured performance

Hardware: **AMD Radeon 740M** — the integrated GPU in a current mid-range laptop
(Ryzen 7 8845HS class). A realistic "judge's laptop", not a workstation. Chromium
via ANGLE/D3D11, WebGL2, vsync on. Field is 128×48×128 (R8). `MAX_3D_TEXTURE_SIZE`
on this GPU: **2048**.

Numbers below are the **first-person frame** — the volume now covers the *entire*
viewport (camera is inside it), which is materially heavier than the original
diorama where it covered ~40%. Measured over a continuous 4 s orbit.

| Config (first-person, full-viewport volume)          | avg fps | worst frame |
|------------------------------------------------------|---------|-------------|
| 1600×900, 64 steps                                   | 60      | 16.8 ms     |
| 1600×900, 128 / 192 / 256 / 512 steps                | 57–60   | occasional 33 ms (one dropped vsync interval) |
| 1600×900, 384 steps                                  | 59      | 50 ms       |
| 1920×1080 @ dpr 2 (≈4K internal), 128 & 256 steps    | 57–59   | 66 ms       |
| 2560×1440 @ dpr 2 (≈5K internal), 128 steps          | 54      | 133 ms — this is the edge |

Takeaway: at native resolution (dpr ≤ 1.75) the first-person view holds
**high-50s to 60 fps at any step count** on an integrated GPU, with the occasional
single dropped frame during fast camera motion. It only really strains past
~4K-internal resolution. Because the default density is low, most rays run the
full step count (little early termination), so step count matters more here than
it did in the diorama — but 160+ is visually indistinguishable from 512 with the
dither on, and the tuned default (192 steps, density 0.022, fog 0.011) held a
clean locked 60 fps / 17 ms at 1440×810 in the final check.

Honest measurement caveat: no exact sub-16 ms GPU frame time — uncapped headless
rAF was too noisy (3–20× swings) and Chrome disables the GPU-timer extension.
Read the in-app `<Stats>` panel on real hardware for the true figure.

**Recommended default for the app: ~192 steps at native resolution**, and render
the volume at 0.5–0.75× viewport scale with upsampling if full-screen coverage on
weak iGPUs needs to be bulletproof (see scale concern #5).

## This does NOT mean it's free at real scale — read this before committing

The spike is a 128×48×128 field and a 240 m terrain patch (400² segments). The
rendering *technique* scales; the *data* does not, for free. Concrete concerns for
the full Bay of Bengal / real GLORYS / real GEBCO build:

1. **3D texture memory is the hard wall.** A dense R8 volume at GLORYS 1/12°
   (~1/12° ≈ 9 km) over the BoB (say 6°–24°N, 78°–100°E ≈ 220×260 cells) × ~50
   depth levels = ~2.9 M cells ≈ 2.9 MB at R8 — *fine*. But go to R16F for real
   values (5.7 MB) or push horizontal res to 1/4°-interpolated-to-finer or add
   more vertical levels and it climbs fast; a naive "upsample everything to a
   nice round 512³" is 128 MB at R8 / 256 MB at R16F and blows the budget on a
   shared-memory iGPU. **Mitigation: keep the volume texture coarse on purpose.**
   The spike proves trilinear filtering hides a coarse grid completely — the
   field can be 1/4° or even coarser while the *bathymetry* stays sharp. Decouple
   the two resolutions.

2. **GLORYS depth levels are non-uniform** (dense near surface, sparse deep). A
   regular 3D texture assumes uniform spacing. Either resample to uniform Z
   (loses near-surface detail or wastes texels) or — better — pass a 1D
   depth-remap LUT and convert linear texture-Z to real depth in the shader.
   Design this in from the start; retrofitting it is annoying.

3. **Land / fill values.** Real GLORYS has NaN/fill over land and below the
   seafloor. Trilinear filtering will smear those into valid water at every
   coastline and the seafloor. Need a validity mask (second channel or separate
   texture) and skip-if-invalid in the march loop, plus careful handling so the
   interpolation doesn't bleed. This is fiddly and worth prototyping early with
   one real tile.

4. **Bathymetry at GEBCO resolution** (15 arc-sec ≈ 450 m) over the BoB is
   ~5000×4000 ≈ 20 M vertices as a naive displaced plane — not viable. Needs a
   proper terrain approach: tiled heightmap + LOD, or clipmaps, or just a
   quantized-mesh pipeline. Standard problem, standard solutions, but it's real
   work and the spike's `PlaneGeometry` approach is not it.

5. **Fill-rate at real window sizes + free camera.** Cost = (screen pixels the
   volume covers) × steps. Fullscreen 4K with the volume filling the viewport at
   192 steps is ~1.5 B samples/frame — an iGPU will not hold 60. Mitigations,
   all standard: render the volume at half/quarter resolution and upsample;
   empty-space skipping using a coarse min/max mip of the field + the bathymetry;
   adaptive step size; keep early-ray-termination (already in). Budget for the
   volume to be a half-res pass.

6. **Proper depth compositing** with the terrain mesh (see caveat above) — needed
   before the camera is unconstrained.

7. **Time animation.** Scrubbing through GLORYS timesteps means swapping the 3D
   texture. A full re-upload per frame will stutter. Need async upload
   (`texSubImage3D` in chunks / PBO-style) or a small enough volume that
   re-upload is cheap. Another reason to keep the volume texture small.

8. **Precision for readout.** R8 = 256 levels ≈ 0.11 °C over a 2–30 °C range.
   Fine for the picture, not for "hover to read the exact value" — do that from
   the source array on the CPU/worker, not the texture, or move to R16F
   (half-float linear filtering is widely but not universally supported; needs a
   nearest-filter fallback path).

### Bottom line

Green light on the rendering approach. The risks that remain are **data
plumbing** risks (memory budget, non-uniform depths, land masks, terrain LOD,
texture streaming), not "can WebGL do this" risks. Recommend the next step is a
second small spike that loads **one real GLORYS tile + one real GEBCO tile** and
checks items 1–4 above, before wiring up the full app.
