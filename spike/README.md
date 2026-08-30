# Ocean-Viz — raymarching spike

> Throwaway visual experiment. **Not** the real application. No backend, no AI, no
> real data, no UI panels. Everything here gets deleted or rewritten once the
> go/no-go call is made.

## What this proves / disproves

**Core question:** can Three.js + WebGL2 render a scientific 3D scalar field
(ocean temperature) as a *continuous* volumetric gradient inside a real
bathymetry shape — without it looking like a stack of flat discrete slabs?

See [`SPIKE_FINDINGS.md`](./SPIKE_FINDINGS.md) for the verdict, screenshots and
measured frame rates.

## Run it

```bash
cd spike
npm install
npm run dev        # http://localhost:5180
```

You start low in the water column, looking across the seafloor — first-person,
not a diorama. Drag to look around, scroll to move in/out. The **leva** panel
(top-right) has:

| control       | what it does                                                        |
|---------------|--------------------------------------------------------------------|
| depth clip (Y)| cuts the volume off above a chosen world-Y to reveal a cross-section |
| march steps   | raymarch sample count — the perf/quality knob (default 192)         |
| density       | extinction per world-unit (Beer-Lambert). Default 0.022 → tinted clear water; crank it up to "drown in fog" |
| mask seafloor | toggle the bathymetry clip                                          |
| dither ray start | toggles the blue-noise ray-start jitter (turn off to *see* the banding it removes) |

## Files

| file | role |
|------|------|
| `src/synthetic.js`   | **SYNTHETIC DATA GENERATORS** — simplex-noise seafloor + analytic temperature profile; builds the `Data3DTexture` (128×48×128) and heightmap `DataTexture` |
| `src/Bathymetry.jsx` | 240×240 displaced plane (400 segments), depth-tinted vertex colors |
| `src/VolumeRaymarch.jsx` | the actual test — GLSL3 raymarch `RawShaderMaterial` on the ±120 bounding box |
| `src/App.jsx`        | Canvas, first-person camera, `FogExp2`, lights, OrbitControls, Stats |
| `src/constants.js`   | shared domain box / ranges |

## Perf harness (throwaway)

`check.mjs` / `sweep.mjs` drive headless Chromium (Playwright) to confirm the
shader compiles on a real GPU and to measure frame times. `?steps=`, `?density=`,
`?fog=`, `?clip=`, `?dpr=`, `?mask=0`, `?jitter=0` query params exist only so that
harness can drive the shader/scene. Screenshots from the last run are in
`screenshots/`.
