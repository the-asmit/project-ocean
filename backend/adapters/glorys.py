"""
GLORYS adapter — Copernicus Marine subset + volume-texture derivation.

Graduated from spike-real-data/adapt.py. Verified dataset facts (P7, do not
re-guess): dims (time, depth, latitude, longitude); lat & lon ascending, uniform
1/12 deg; depth ascending, `positive: down`, NON-uniform (1 m -> 74 m steps);
thetao in degrees C, packed int16, fill decoded to NaN by xarray; NaN means land
AND below-seafloor, undifferentiated.

Two proven pieces carried forward:
  * VALIDITY CHANNEL — the field texture is RG8: R = normalised value, G = 0/1
    validity. R is dilate-filled from nearest valid neighbours so trilinear
    filtering near a coastline blends valid<->plausible, never valid<->garbage;
    G is the true mask and is NOT dilated.
  * GUARD ROW — one extra all-invalid level. The world box spans the full
    bathymetric range but thetao stops at ~454 m, so the depth LUT saturates
    into the guard row below that and the shader's existing validity test masks
    it with no extra shader code.
"""
from __future__ import annotations

import numpy as np
import xarray as xr

from .bathymetry import BOX_DEPTH, ynorm_to_depth

DATASET_ID = "cmems_mod_glo_phy_my_0.083deg_P1D-m"
SOURCE_NAME = "GLORYS12V1"

# Variables the UI may offer. Only `thetao` is wired to real data today.
VARIABLES = {
    "thetao": {
        "label": "Temperature",
        "units": "°C",
        "available": True,
        "range": [8.0, 31.0],   # fixed colour-ramp range so tiles are comparable
    },
    "so": {"label": "Salinity", "units": "PSU", "available": False, "range": [32.0, 37.0]},
    "uo": {"label": "Currents", "units": "m/s", "available": False, "range": [-1.5, 1.5]},
}

LUT_N = 128


def dilate_fill_3d(vals: np.ndarray, valid: np.ndarray, iters: int = 8) -> np.ndarray:
    """Fill invalid cells from valid 6-neighbours, iteratively. `valid` (the true
    mask) is never modified — it becomes the G channel."""
    out = vals.astype(np.float32).copy()
    known = valid.copy()
    for _ in range(iters):
        if known.all():
            break
        acc = np.zeros_like(out)
        cnt = np.zeros_like(out)
        for ax in range(3):
            for sh in (-1, 1):
                acc += np.where(np.roll(known, sh, axis=ax), np.roll(out, sh, axis=ax), 0.0)
                cnt += np.roll(known, sh, axis=ax)
        newly = (~known) & (cnt > 0)
        out[newly] = acc[newly] / cnt[newly]
        known = known | newly
    out[~known] = 0.0
    return out


def fetch_subset(bbox: dict, date: str, variable: str, out_nc,
                 username: str, password: str, max_depth_m: float = 500.0):
    """Download one GLORYS daily tile for `bbox`/`date`/`variable`."""
    import copernicusmarine
    out_nc = str(out_nc)
    copernicusmarine.subset(
        dataset_id=DATASET_ID,
        variables=[variable],
        start_datetime=f"{date}T00:00:00",
        end_datetime=f"{date}T00:00:00",
        minimum_depth=0,
        maximum_depth=max_depth_m,
        output_directory=out_nc.rsplit("/", 1)[0] if "/" in out_nc else ".",
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


def build(nc_path, variable: str, bathy_max_m: float) -> dict:
    """Derive the RG8 3-D volume texture + depth LUT from a GLORYS NetCDF.

    Layout: data[(k*H_TEX + j)*W + i] * 2, with i=lon(W), j=level(H_TEX),
    k=lat(D) — i.e. C-order of (D, H_TEX, W, 2). Matches Data3DTexture(W,H,D).
    """
    ds = xr.open_dataset(nc_path, decode_timedelta=True)
    da = ds[variable].isel(time=0)                    # (depth, lat, lon)
    assert list(da.dims) == ["depth", "latitude", "longitude"], da.dims

    depth = ds["depth"].values.astype("float64")      # ascending, metres
    lat = ds["latitude"].values.astype("float64")     # ascending
    lon = ds["longitude"].values.astype("float64")    # ascending
    H, D, W = da.shape
    max_depth_m = float(depth[-1])

    vmin, vmax = VARIABLES[variable]["range"]
    raw = da.values.astype("float64")                 # NaN = land / below seafloor
    valid = np.isfinite(raw)

    norm = np.clip((raw - vmin) / (vmax - vmin), 0.0, 1.0)
    # dilate-fill in (lon, level, lat) order, then transpose to (lat, level, lon)
    filled = dilate_fill_3d(
        np.transpose(np.nan_to_num(norm), (2, 0, 1)),
        np.transpose(valid, (2, 0, 1)),
    )
    R = np.round(np.clip(np.transpose(filled, (2, 1, 0)), 0, 1) * 255).astype(np.uint8)
    G = np.where(np.transpose(np.transpose(valid, (2, 0, 1)), (2, 1, 0)), 255, 0).astype(np.uint8)

    # guard row: one extra all-invalid level (see module docstring)
    H_TEX = H + 1
    rg = np.zeros((D, H_TEX, W, 2), np.uint8)
    rg[:, :H, :, 0] = R
    rg[:, :H, :, 1] = G
    rg[:, H, :, 0] = R[:, H - 1, :]
    rg[:, H, :, 1] = 0

    # depth LUT: box depth fraction (== ynorm) -> field-texture row texcoord
    guard = (H + 0.5) / H_TEX
    lut = []
    for e in range(LUT_N):
        ynorm = e / (LUT_N - 1)
        d = float(ynorm_to_depth(ynorm, bathy_max_m))
        if d > max_depth_m:
            lut.append(guard)
            continue
        lo = int(np.clip(np.searchsorted(depth, d, "right") - 1, 0, H - 2))
        frac = float(np.clip((d - depth[lo]) / (depth[lo + 1] - depth[lo]), 0.0, 1.0))
        lut.append((lo + frac + 0.5) / H_TEX)

    return {
        "field_rg8": np.ascontiguousarray(rg),
        "meta": {
            "W": W, "H": H_TEX, "D": D,
            "levelsReal": H,
            "variable": variable,
            "variableLabel": VARIABLES[variable]["label"],
            "units": VARIABLES[variable]["units"],
            "valueMin": vmin, "valueMax": vmax,
            "dataMin": float(np.nanmin(raw)), "dataMax": float(np.nanmax(raw)),
            "maxDepthM": max_depth_m,
            "depthLevels": [float(x) for x in depth],
            "depthLUT": lut,
            "nanFraction": float(np.isnan(raw).mean()),
            "lonMin": float(lon[0]), "lonMax": float(lon[-1]),
            "latMin": float(lat[0]), "latMax": float(lat[-1]),
            "source": SOURCE_NAME,
            "datasetId": DATASET_ID,
        },
    }


def sample_point(nc_path, variable: str, lat_q: float, lon_q: float, depth_q: float) -> dict:
    """On-demand point query — trilinear over the native grid, NaN-aware.
    Returns the value plus the real grid cell it came from (no invention)."""
    ds = xr.open_dataset(nc_path, decode_timedelta=True)
    da = ds[variable].isel(time=0)
    depth = ds["depth"].values.astype("float64")
    lat = ds["latitude"].values.astype("float64")
    lon = ds["longitude"].values.astype("float64")

    if not (lat[0] <= lat_q <= lat[-1] and lon[0] <= lon_q <= lon[-1]):
        return {"value": None, "reason": "outside tile bounds"}

    k = int(np.clip(np.searchsorted(depth, depth_q, "right") - 1, 0, depth.size - 1))
    j = int(np.clip(np.searchsorted(lat, lat_q, "right") - 1, 0, lat.size - 2))
    i = int(np.clip(np.searchsorted(lon, lon_q, "right") - 1, 0, lon.size - 2))
    ty = (lat_q - lat[j]) / (lat[j + 1] - lat[j])
    tx = (lon_q - lon[i]) / (lon[i + 1] - lon[i])

    blk = da.values[k, j:j + 2, i:i + 2].astype("float64")
    if not np.isfinite(blk).any():
        return {"value": None, "reason": "land or below seafloor",
                "nearestLevelM": float(depth[k])}
    w = np.array([[(1 - ty) * (1 - tx), (1 - ty) * tx], [ty * (1 - tx), ty * tx]])
    m = np.isfinite(blk)
    val = float((blk[m] * w[m]).sum() / w[m].sum())
    return {
        "value": val,
        "units": VARIABLES[variable]["units"],
        "nearestLevelM": float(depth[k]),
        "gridLat": float(lat[j]), "gridLon": float(lon[i]),
        "interpolated": bool(m.all()),
    }
