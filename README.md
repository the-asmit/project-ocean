# Ocean-Viz

Immersive 3D ocean data visualization — SIH PS 26067 (INCOIS / MoES).
Real GLORYS12V1 temperature + GLORYS bathymetry, volumetrically raymarched, with
free-fly navigation and point interrogation.

    backend/    FastAPI + Copernicus Marine adapters + filesystem cache
    frontend/   React + @react-three/fiber
    spike/            throwaway — shader validation      (superseded)
    spike-real-data/  throwaway — real-data validation   (superseded)

## Run

Backend needs Python (this machine has it only in WSL):

```bash
cd backend
uv venv --python 3.12 && uv pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173  (proxies /api -> :8000)
```

CMEMS credentials are read from `backend/.env` (`CMEMS_USERNAME`,
`CMEMS_PASSWORD`). The cache is pre-warmed with the validated coastal and open
tiles, so the app runs offline against those without hitting Copernicus.

## Controls

| | |
|---|---|
| **Fly** (default) | `W A S D` move · `Q`/`E` down/up · `Shift` boost · drag to look · scroll = speed |
| **Orbit** | drag to orbit · scroll to zoom |
| `F` | switch nav mode |
| hover | live readout — leader-line HUD with lat/lon/depth/value |
| click | pin the point, open the detail panel · `Esc` closes |

## API

| endpoint | returns |
|---|---|
| `GET /health` | status + what is cached |
| `GET /regions` | named regions, variables, defaults |
| `GET /dataset?region=&date=&variable=` | JSON manifest: dims, depth LUT, ranges, source |
| `GET /slice/volume?region=&date=&variable=` | binary RG8 3-D field (R = value, G = validity) |
| `GET /bathymetry?region=` | binary f32 seafloor world-Y grid (NaN = land) |
| `GET /bathymetry/height?region=` | binary u8 seafloor mask texture |
| `GET /point?lat=&lon=&depth=&region=&date=&variable=` | on-demand point query from the source NetCDF |

Cache: `backend/cache/raw/<key>.nc` (Copernicus downloads) and
`backend/cache/derived/<key>/` (render products), keyed by region + date +
variable. Nothing re-downloads once cached.

## Carried forward from the spikes — do not re-derive

Each of these was validated and is load-bearing, not decoration:

- **Raymarch shader** (`frontend/src/scene/VolumeRaymarch.jsx`) — ray/AABB,
  front-to-back Beer-Lambert compositing, early termination, blue-noise dithered
  ray start, trilinear `Data3DTexture`.
- **Depth-remap LUT** — GLORYS depth levels are non-uniform (1 m → 74 m steps).
  128-entry LUT, uploaded as a `uniform float[]` (a per-step float-texture fetch
  measured ~35% of frame time on the target iGPU).
- **Thickness-aware density** — scales extinction by the water column standing at
  that x/z. Fixes the neon-cyan shelf ribbon.
- **Validity channel + dilate-fill** — RG8 field: R dilate-filled from nearest
  valid neighbours so trilinear never blends valid↔garbage at coastlines; G is
  the true 0/1 mask and is *not* dilated. Shader skips `g < 0.5`.
- **Guard row** — one extra all-invalid level so "no data below 454 m" masks
  itself with zero extra shader code.
- **`depth_to_ynorm`** (`backend/adapters/bathymetry.py`) — the *single* vertical
  mapping shared by terrain mesh, seafloor mask and depth LUT. Scaled by the real
  deepest sounding; scaling by the temperature extent once flattened 65% of the
  seafloor.
- **Bicubic terrain + synthetic detail** — Catmull-Rom through every real
  sounding, plus a zero-mean sub-grid noise layer that is **disclosed in the UI
  and toggleable** (P3).
- **First-person framing, `FogExp2` 0.011, density 0.022** — the tuned "open and
  breathable" look.

## Known limits

- Only `thetao` has real data; salinity and currents are marked *soon* and
  disabled in the UI.
- `thetao` reaches 454 m but bathymetry reaches 4183 m. Hovering seafloor deeper
  than that samples the deepest level with data and **says so** in the readout.
- Land/water is a binary 1/12° mask, so coastlines are visibly ~9 km blocky.
- Depth axis is non-linearly exaggerated (curve 0.42) — labelled in the UI.
