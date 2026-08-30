# Ocean-Viz — real-data spike

Throwaway. Real GLORYS temperature + bathymetry through the proven `spike/`
raymarch shader. `spike/` is untouched; the shader here is a copy with a ~9-line
field-sampling delta (see `src/VolumeRaymarch.jsx`, marked `REAL-DATA DELTA`).

- [`INSPECTION.md`](./INSPECTION.md) — raw dataset structure (P7 report)
- [`FINDINGS.md`](./FINDINGS.md) — verdict + what real data revealed
- [`FIXES.md`](./FIXES.md) — terrain blockiness + neon shelf ribbon fixes, and
  the terrain-scaling bug they uncovered

## Reproduce

```bash
# data (needs WSL/Linux python + the copernicusmarine toolbox; creds in .env)
python fetch.py           # brief's box (turned out to be all deep ocean)
python fetch_coastal.py   # Sri Lanka + shelf — the tile that tests the hard paths
python inspect_data.py    # structure report
python inspect_coastal.py # NaN / land / shallow-seafloor report
python adapt.py           # -> public/data/<tile>_{field.bin,height.bin,bathy.bin,meta.json}

# app
npm install
npm run dev               # http://localhost:5180
```

### URL knobs

| param | effect |
|-------|--------|
| `?tile=coastal` (default) / `?tile=open` | which tile |
| `?detail=0` / `?detail=<n>` | hide / scale the **synthetic** seafloor texture |
| `?thin=1` | disable thickness-aware density (restores the neon shelf ribbon) |
| `?nanmask=0` | show the land bleed the validity mask prevents |
| `?seg=256` | coarser terrain mesh (default 512) |
| `?clip=-2` | depth cross-section |
| `?steps= &density= &fog=` | raymarch tuning |
| `?cam=x,y,z&tgt=x,y,z` | pin an exact viewpoint (screenshot harness) |

## Data pipeline (adapt.py)

| output | format | role |
|--------|--------|------|
| `<tile>_field.bin` | RG8 3D, 61×**32**×61 | R = temp norm to [8,31]°C, G = validity (0/1). Last level is an all-invalid **guard row** |
| `<tile>_height.bin` | R8 512×512 | seafloor height for the shader's floor mask (bicubic) |
| `<tile>_bathy.bin` | f32 61×61 | seafloor world-Y for the terrain mesh (NaN = land) |
| `<tile>_meta.json` | json | dims, ranges, + `depthLUT` (128 floats, non-uniform-Z remap) |

Coordinate convention matches the shader: lon→x, lat→z (both flipped so the
coastline faces the default camera). Vertical: **one** shared mapping
`world_y = -6 * (m / bathy_max)^0.42` drives the mesh, the floor mask and the
LUT — see the `adapt.py` docstring and [`FIXES.md`](./FIXES.md).
