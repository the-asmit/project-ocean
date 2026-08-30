"""
Adapter: real GLORYS tile -> the binary blobs the raymarch app loads.

Produces, per tile, in public/data/:
  <tile>_field.bin   RG8 3D texture  W(lon) x (H+1)(level) x D(lat), interleaved
                       R = temperature normalised to [TEMP_MIN, TEMP_MAX]
                       G = validity  (255 valid, 0 = land / below-seafloor)
                       the extra last row is an all-invalid GUARD row (see below)
  <tile>_height.bin  U8[N*N]         seafloor height, normalised to [FLOOR_MIN,0]
  <tile>_bathy.bin   Float32[61*61]  seafloor world-Y for the terrain mesh
                       (NaN = land)
  <tile>_meta.json   dims/ranges + `depthLUT` (128 floats, non-uniform-Z remap)

Coordinate convention matches the proven shader:
  lon  -> texture X / world x   (both ascending)
  lat  -> texture Z / world z   (both ascending)
  depth-> texture Y             (row 0 = surface level, row H-1 = deepest);
                                 the LUT owns the world-y -> row mapping

--- VERTICAL MAPPING (fixed 2026-08-30) -------------------------------------
Previously the terrain was scaled by `maxDepthM` = 453.9 m (the depth extent of
the *temperature* data). Real bathymetry in the coastal tile reaches 4183 m, so
65% of the seafloor clamped to a dead-flat plane at the box floor and the shelf
became a vertical cliff — the "shark teeth". Root cause of Fix 1.

Now ONE shared mapping, `depth_to_ynorm`, drives the terrain mesh, the seafloor
height texture AND the depth LUT, so water and seafloor stay registered:

    ynorm(m) = (m / bathy_max_m) ** DEPTH_CURVE        # 0 = surface, 1 = box floor
    world_y  = -6 * ynorm

DEPTH_CURVE < 1 is a depth-dependent vertical exaggeration: it stretches the
shallow shelf and compresses the abyssal plain, so BOTH are legible in one view.
This is a labelled, monotonic, invertible transform of the depth AXIS — standard
practice in bathymetric visualisation. It does not alter, reorder or invent any
depth value; every real sounding keeps its exact relative position. Set
DEPTH_CURVE = 1.0 for a strictly linear depth axis.

Because the box now spans the full bathymetric range but `thetao` only reaches
453.9 m, the field texture gets one extra all-invalid GUARD row and the LUT
saturates into it below 453.9 m. The shader's existing `.g < 0.5 -> continue`
then masks "no temperature data here" for free, with zero added shader code.
"""
import json
import pathlib

import numpy as np
import xarray as xr

OUT = pathlib.Path("public/data")
OUT.mkdir(parents=True, exist_ok=True)

# fixed colour-ramp range so both tiles are directly comparable
TEMP_MIN, TEMP_MAX = 8.0, 31.0
# must match src/constants.js
FLOOR_MIN, FLOOR_MAX = -6.0, 0.0
BOX = dict(min=[-120, -6, -120], max=[120, 0, 120])
HEIGHT_N = 512          # was 256 — finer floor mask to match the smoother mesh
DEPTH_CURVE = 0.42      # see module docstring; 1.0 == linear depth axis


def clip01(a):
    return np.clip(a, 0.0, 1.0)


def depth_to_ynorm(m, bathy_max_m):
    """Depth in metres -> normalised box depth (0 = surface, 1 = box floor).
    THE single vertical mapping — terrain mesh, floor mask and depth LUT all go
    through this so they stay registered. Monotonic; see module docstring."""
    return clip01(np.asarray(m, dtype="float64") / bathy_max_m) ** DEPTH_CURVE


def catmull_rom_upsample(grid, out_n):
    """Bicubic (Catmull-Rom) upsample of a 2-D grid to out_n x out_n.
    Smooth C1 interpolation *through* every real sample, so the authoritative
    GLORYS soundings are preserved exactly at their own locations and only the
    space between them is interpolated. Separable: rows then columns."""
    def axis(a, n_out):
        n_in = a.shape[-1]
        f = np.linspace(0, n_in - 1, n_out)
        i1 = np.clip(np.floor(f).astype(int), 0, n_in - 1)
        t = (f - i1)[None, :]
        i0 = np.clip(i1 - 1, 0, n_in - 1)
        i2 = np.clip(i1 + 1, 0, n_in - 1)
        i3 = np.clip(i1 + 2, 0, n_in - 1)
        p0, p1, p2, p3 = a[..., i0], a[..., i1], a[..., i2], a[..., i3]
        t2, t3 = t * t, t * t * t
        return 0.5 * (
            (2 * p1)
            + (-p0 + p2) * t
            + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
            + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
        )
    return axis(axis(grid, out_n).T, out_n).T


def dilate_fill(vals, valid, iters=6):
    """Fill invalid cells with the mean of valid 6-neighbours, iteratively.
    Keeps trilinear interpolation near coastlines sane (valid<->plausible,
    never valid<->garbage). `valid` (the true mask) is NOT modified."""
    vals = vals.astype(np.float32).copy()
    known = valid.copy()
    for _ in range(iters):
        if known.all():
            break
        acc = np.zeros_like(vals)
        cnt = np.zeros_like(vals)
        for ax in range(3):
            for sh in (-1, 1):
                rolled_v = np.roll(vals, sh, axis=ax)
                rolled_k = np.roll(known, sh, axis=ax)
                acc += np.where(rolled_k, rolled_v, 0.0)
                cnt += rolled_k
        newly = (~known) & (cnt > 0)
        vals[newly] = acc[newly] / cnt[newly]
        known = known | newly
    vals[~known] = 0.0
    return vals


def dilate_fill_2d(vals, valid, iters=8):
    """2-D version of dilate_fill — extends depth values into land cells so the
    bicubic upsample never interpolates against NaN. The land mask itself is
    tracked separately and is what actually decides land vs water."""
    vals = vals.astype("float64").copy()
    known = valid.copy()
    for _ in range(iters):
        if known.all():
            break
        acc = np.zeros_like(vals)
        cnt = np.zeros_like(vals)
        for ax in range(2):
            for sh in (-1, 1):
                acc += np.where(np.roll(known, sh, axis=ax), np.roll(vals, sh, axis=ax), 0.0)
                cnt += np.roll(known, sh, axis=ax)
        newly = (~known) & (cnt > 0)
        vals[newly] = acc[newly] / cnt[newly]
        known = known | newly
    vals[~known] = np.nanmax(vals[known]) if known.any() else 0.0
    return vals


def process(tile, thetao_nc, bathy_nc):
    ds = xr.open_dataset(thetao_nc, decode_timedelta=True)
    db = xr.open_dataset(bathy_nc, decode_timedelta=True)

    th = ds["thetao"].isel(time=0)                       # (depth, lat, lon)
    depth = ds["depth"].values.astype("float64")         # ascending, metres
    lat = ds["latitude"].values.astype("float64")        # ascending
    lon = ds["longitude"].values.astype("float64")       # ascending
    H, D_, W = th.shape                                  # depth, lat, lon
    assert list(th.dims) == ["depth", "latitude", "longitude"], th.dims
    max_depth_m = float(depth[-1])

    temp = th.values.astype("float64")                   # (H, lat, lon)  NaN=missing
    valid_hlw = np.isfinite(temp)                        # (H, lat, lon)

    # Orientation: the proven first-person camera looks toward +x / +z. Every
    # output blob below is flipped on both horizontal axes (see FLIP) so the
    # land-bearing corner (low lon / low lat = India + Sri Lanka) ends up in
    # front of that camera. Mirrors geography E<->W, N<->S — cosmetic only.
    FLIP = (slice(None, None, -1), slice(None, None, -1))  # [::-1, ::-1] on (lat,lon)

    # normalise temperature -> 0..1
    norm = clip01((temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN))
    # arrange as (W lon, H level, D lat) then dilate-fill in that space
    norm_whd = np.transpose(np.nan_to_num(norm), (2, 0, 1))     # (lon, level, lat)
    valid_whd = np.transpose(valid_hlw, (2, 0, 1))
    filled = dilate_fill(norm_whd, valid_whd, iters=8)

    # interleave RG8 in the layout the JS expects: data[i + j*W + k*W*H]
    # i=lon(W), j=level(H), k=lat(D)  -> memory order k,j,i  (C-order of (D,H,W))
    R = np.round(clip01(np.transpose(filled, (2, 1, 0))) * 255).astype(np.uint8)   # (D,H,W)
    G = np.where(np.transpose(valid_whd, (2, 1, 0)), 255, 0).astype(np.uint8)      # (D,H,W)

    # GUARD ROW: one extra level, validity 0. The box now spans the full
    # bathymetric range but thetao stops at max_depth_m, so the LUT saturates
    # into this row for anything deeper and the shader's existing validity test
    # masks it. Keeps "no data below 454 m" honest with no added shader code.
    H_TEX = H + 1
    rg = np.zeros((D_, H_TEX, W, 2), np.uint8)
    rg[:, :H, :, 0] = R
    rg[:, :H, :, 1] = G
    rg[:, H, :, 0] = R[:, H - 1, :]   # colour copied from the deepest real level
    rg[:, H, :, 1] = 0                # ...but flagged invalid, so it never draws
    rg = rg[FLIP[0], :, FLIP[1], :]                       # flip lat + lon axes
    (OUT / f"{tile}_field.bin").write_bytes(np.ascontiguousarray(rg).tobytes())

    # --- bathymetry (drives the vertical mapping for everything) --------------
    deptho = db["deptho"].values.astype("float64")       # (lat, lon), NaN = land
    is_land = np.isnan(deptho)
    bathy_max_m = float(np.nanmax(deptho))               # the REAL deepest sounding

    # --- depth-remap LUT: box-depth fraction -> field-texture row texcoord -----
    # 128 entries, shipped inline in meta.json and uploaded as a uniform float[]
    # (a dependent float-texture fetch per march step was measurably slow on the
    # target iGPU; a uniform array removes the texture unit entirely).
    # Entry e corresponds to box depth fraction e/(N-1), which is `ynorm`, so we
    # invert depth_to_ynorm to get metres before looking up the GLORYS level.
    LUT_N = 128
    lut = []
    guard_row = (H + 0.5) / H_TEX                        # centre of the invalid row
    for e in range(LUT_N):
        ynorm = e / (LUT_N - 1)
        d = bathy_max_m * (ynorm ** (1.0 / DEPTH_CURVE))  # inverse of depth_to_ynorm
        if d > max_depth_m:
            lut.append(guard_row)                         # below the thetao data
            continue
        lo = int(np.clip(np.searchsorted(depth, d, "right") - 1, 0, H - 2))
        frac = float(np.clip((d - depth[lo]) / (depth[lo + 1] - depth[lo]), 0.0, 1.0))
        row_index = lo + frac                             # 0 .. H-1
        lut.append((row_index + 0.5) / H_TEX)             # texcoord centre of that row

    # height texture for the shader's seafloor mask — bicubic-upsampled from the
    # native grid so the floor mask matches the smooth mesh (Fix 1).
    dep_filled = dilate_fill_2d(deptho, ~is_land)
    dep_up = catmull_rom_upsample(dep_filled, HEIGHT_N)
    land_up = catmull_rom_upsample(is_land.astype("float64"), HEIGHT_N) > 0.5
    floor_y = -6.0 * depth_to_ynorm(dep_up, bathy_max_m)
    floor_y[land_up] = 0.0                                # land: clip whole column
    s = np.clip((floor_y - FLOOR_MIN) / (FLOOR_MAX - FLOOR_MIN), 0.0, 1.0)
    height_u8 = np.round(s * 255).astype(np.uint8)[FLIP[0], FLIP[1]]   # (lat-row, lon-col)
    (OUT / f"{tile}_height.bin").write_bytes(np.ascontiguousarray(height_u8).tobytes())

    # bathy for the visible mesh: seafloor world-Y at native grid, NaN = land.
    # Same mapping as the height texture above — the mesh does its own bicubic
    # upsample + synthetic detail in Bathymetry.jsx.
    bathy_y = (-6.0 * depth_to_ynorm(dep_filled, bathy_max_m)).astype(np.float32)
    bathy_y[is_land] = np.nan
    bathy_y = bathy_y[FLIP[0], FLIP[1]]
    (OUT / f"{tile}_bathy.bin").write_bytes(np.ascontiguousarray(bathy_y).astype("<f4").tobytes())

    flat = float(np.mean(bathy_y[np.isfinite(bathy_y)] <= -5.999))

    meta = dict(
        tile=tile,
        W=W, H=H_TEX, D=int(D_), heightN=HEIGHT_N,
        levelsReal=H, guardRow=True,
        tempMin=TEMP_MIN, tempMax=TEMP_MAX,
        floorMin=FLOOR_MIN, floorMax=FLOOR_MAX,
        boxMin=BOX["min"], boxMax=BOX["max"],
        maxDepthM=max_depth_m,
        bathyMaxM=bathy_max_m,
        depthCurve=DEPTH_CURVE,
        flatFraction=flat,
        depthLUT=lut,
        orientationFlipped=True,
        lonMin=float(lon[0]), lonMax=float(lon[-1]),
        latMin=float(lat[0]), latMax=float(lat[-1]),
        latAscending=bool(lat[1] > lat[0]),
        lonAscending=bool(lon[1] > lon[0]),
        depthLevels=[float(x) for x in depth],
        nanFraction=float(np.isnan(temp).mean()),
        tempDataMin=float(np.nanmin(temp)), tempDataMax=float(np.nanmax(temp)),
        landSurfaceCells=int(np.isnan(temp[0]).sum()),
        bathyMinM=float(np.nanmin(deptho)),
        bathyLandCells=int(is_land.sum()),
    )
    (OUT / f"{tile}_meta.json").write_text(json.dumps(meta, indent=2))
    print(f"[{tile}] field {rg.shape} (incl. guard row)  nan={100*meta['nanFraction']:.1f}%  "
          f"temp {meta['tempDataMin']:.1f}..{meta['tempDataMax']:.1f}C\n"
          f"         bathy {meta['bathyMinM']:.0f}..{bathy_max_m:.0f} m  land={meta['bathyLandCells']}  "
          f"curve={DEPTH_CURVE}  seafloor flat-at-box-floor: {100*flat:.1f}%")


process("open", "data/glorys_thetao_tile.nc", "data/glorys_bathy_tile.nc")
process("coastal", "data/glorys_thetao_coastal.nc", "data/glorys_bathy_coastal.nc")
print("wrote ->", OUT)
