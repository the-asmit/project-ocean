"""
Bathymetry adapter — GLORYS static bathy fetch + the vertical mapping.

Graduated from spike-real-data/adapt.py. The vertical mapping lives here because
it is bathymetry-derived and EVERYTHING else (terrain mesh, seafloor mask, the
temperature depth-LUT) must go through this one function or they de-register.

--- VERTICAL MAPPING -------------------------------------------------------
    ynorm(m) = (m / bathy_max_m) ** DEPTH_CURVE     # 0 = surface, 1 = box floor
    world_y  = BOX_DEPTH * -ynorm

DEPTH_CURVE < 1 is a depth-dependent vertical exaggeration: it stretches the
shallow shelf and compresses the abyssal plain so both are legible in one view.
Monotonic, invertible, labelled in the UI. It does not alter, reorder or invent
any sounding — every real value keeps its exact relative position. Set
DEPTH_CURVE = 1.0 for a strictly linear depth axis.

Scaling by the REAL deepest sounding matters: an earlier version scaled by the
temperature data's 454 m extent, which clamped 65% of the seafloor to a flat
plane. Do not reintroduce that.
"""
from __future__ import annotations

import numpy as np
import xarray as xr

# --- world-space domain (shared with the frontend via /dataset meta) ---------
BOX_SPAN = 240.0    # horizontal extent in world units (x and z)
BOX_DEPTH = 6.0     # vertical extent; sea surface at y=0, box floor at y=-6
DEPTH_CURVE = 0.42  # see module docstring; 1.0 == linear depth axis
HEIGHT_N = 512      # resolution of the seafloor mask texture

STATIC_DATASET = "cmems_mod_glo_phy_my_0.083deg_static"
STATIC_PART = "bathy"


def depth_to_ynorm(m, bathy_max_m: float):
    """Depth in metres -> normalised box depth (0 = surface, 1 = box floor)."""
    v = np.clip(np.asarray(m, dtype="float64") / bathy_max_m, 0.0, 1.0)
    return v ** DEPTH_CURVE


def ynorm_to_depth(ynorm, bathy_max_m: float):
    """Inverse of depth_to_ynorm — normalised box depth -> metres."""
    v = np.clip(np.asarray(ynorm, dtype="float64"), 0.0, 1.0)
    return bathy_max_m * (v ** (1.0 / DEPTH_CURVE))


def catmull_rom_upsample(grid: np.ndarray, out_n: int) -> np.ndarray:
    """Bicubic (Catmull-Rom) upsample of a 2-D grid to out_n x out_n.
    C1-continuous and passes exactly through every real sample, so authoritative
    soundings are preserved and only the space between them is interpolated."""
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


def dilate_fill_2d(vals: np.ndarray, valid: np.ndarray, iters: int = 8) -> np.ndarray:
    """Extend values into invalid (land) cells so interpolation never touches
    NaN. The land mask is tracked separately and is what decides land vs water."""
    out = vals.astype("float64").copy()
    known = valid.copy()
    for _ in range(iters):
        if known.all():
            break
        acc = np.zeros_like(out)
        cnt = np.zeros_like(out)
        for ax in range(2):
            for sh in (-1, 1):
                acc += np.where(np.roll(known, sh, axis=ax), np.roll(out, sh, axis=ax), 0.0)
                cnt += np.roll(known, sh, axis=ax)
        newly = (~known) & (cnt > 0)
        out[newly] = acc[newly] / cnt[newly]
        known = known | newly
    out[~known] = float(np.nanmax(out[known])) if known.any() else 0.0
    return out


def fetch_static(bbox: dict, out_nc, username: str, password: str):
    """Download the GLORYS static bathy tile for `bbox` to `out_nc`."""
    import copernicusmarine
    out_nc = str(out_nc)
    copernicusmarine.subset(
        dataset_id=STATIC_DATASET,
        dataset_part=STATIC_PART,
        variables=["deptho", "mask", "deptho_lev"],
        output_directory=str(out_nc.rsplit("/", 1)[0]) if "/" in out_nc else ".",
        output_filename=out_nc.rsplit("/", 1)[-1],
        overwrite=True,
        username=username,
        password=password,
        minimum_longitude=bbox["lon_min"],
        maximum_longitude=bbox["lon_max"],
        minimum_latitude=bbox["lat_min"],
        maximum_latitude=bbox["lat_max"],
    )
    return out_nc


def build(nc_path) -> dict:
    """Derive the renderable bathymetry products from a static-bathy NetCDF.

    Returns dict with:
      bathy_f32   (lat, lon) float32 seafloor world-Y, NaN = land   -> mesh
      height_u8   (N, N)     uint8  normalised floor height          -> shader mask
      meta        dims / ranges / bathy_max_m
    """
    db = xr.open_dataset(nc_path, decode_timedelta=True)
    deptho = db["deptho"].values.astype("float64")   # (lat, lon), metres, +down, NaN=land
    lat = db["latitude"].values.astype("float64")    # ascending
    lon = db["longitude"].values.astype("float64")   # ascending
    is_land = np.isnan(deptho)
    bathy_max_m = float(np.nanmax(deptho))

    filled = dilate_fill_2d(deptho, ~is_land)

    # seafloor mask texture — bicubic so it matches the smooth mesh
    dep_up = catmull_rom_upsample(filled, HEIGHT_N)
    land_up = catmull_rom_upsample(is_land.astype("float64"), HEIGHT_N) > 0.5
    floor_y = -BOX_DEPTH * depth_to_ynorm(dep_up, bathy_max_m)
    floor_y[land_up] = 0.0                            # land: clip the whole column
    s = np.clip((floor_y - (-BOX_DEPTH)) / BOX_DEPTH, 0.0, 1.0)
    height_u8 = np.ascontiguousarray(np.round(s * 255).astype(np.uint8))

    # native-grid seafloor for the terrain mesh; NaN marks land
    bathy_y = (-BOX_DEPTH * depth_to_ynorm(filled, bathy_max_m)).astype(np.float32)
    bathy_y[is_land] = np.nan

    return {
        "bathy_f32": np.ascontiguousarray(bathy_y),
        "height_u8": height_u8,
        "meta": {
            "bathyW": int(lon.size),
            "bathyD": int(lat.size),
            "heightN": HEIGHT_N,
            "bathyMaxM": bathy_max_m,
            "bathyMinM": float(np.nanmin(deptho)),
            "landCells": int(is_land.sum()),
            "depthCurve": DEPTH_CURVE,
            "boxSpan": BOX_SPAN,
            "boxDepth": BOX_DEPTH,
            "lonMin": float(lon[0]), "lonMax": float(lon[-1]),
            "latMin": float(lat[0]), "latMax": float(lat[-1]),
        },
    }
