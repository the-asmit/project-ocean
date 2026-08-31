"""
GLORYS adapter — Copernicus Marine subset + volume-texture derivation.

Graduated from spike-real-data/adapt.py. Verified dataset facts (P7, do not
re-guess): dims (time, depth, latitude, longitude); lat & lon ascending, uniform
1/12 deg; depth ascending, `positive: down`, NON-uniform (1 m -> 74 m steps);
thetao in degrees C and so in practical salinity (CF units attribute `1e-3`),
both packed int16, fill decoded to NaN by xarray; NaN means land AND
below-seafloor, undifferentiated. Verified 2026-08-31: so shares thetao's grid
exactly — identical depth/lat/lon arrays and a bit-identical NaN mask — so a
variable switch never invalidates a slice, a pin or a probe index.

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

# Variables the UI may offer.
#
# RANGE MODE is per variable, and the difference is physical, not cosmetic.
#
#   "fixed" — one clamp for every tile, so a colour means the same value
#     everywhere. Works for temperature because its range inside ANY tile is set
#     by the vertical thermocline, which every tile has: measured across the
#     Bay of Bengal, the head of the Bay and the Arabian Sea on 2026-06-11, the
#     within-tile span was 19.9-23.1 degC against a between-tile spread of ~24,
#     and [8, 33] covers all three using 79.5-92.2% of the ramp.
#
#   "tile" — the clamp is the tile's own min/max. Salinity needs this. Its
#     range is set by GEOGRAPHY (river plume vs evaporative basin), which is
#     nearly flat within a tile and enormous between them: within-tile span
#     1.4-3.8 against a between-tile spread of 27.3 (9.40 PSU in the
#     Ganges-Brahmaputra plume, 36.69 in the Arabian Sea). No fixed clamp
#     survives that. One covering the domain renders the Bay tile in 13.5% of
#     the ramp and the Arabian Sea in 5.1% — both a single flat colour; one
#     tuned to the Bay clips 92.8% of an Arabian Sea tile to ramp-max.
#     Per-tile min/max gives 94.8-98.6% of the ramp and clips NOTHING.
#
# The cost is real and must be disclosed in the UI, not buried: with "tile",
# the same colour on two different tiles is not the same salinity.
VARIABLES = {
    "thetao": {
        "label": "Temperature",
        "short": "Temp",
        "units": "°C",
        "available": True,
        "rangeMode": "fixed",
        # 31 was set from a January tile and the June pre-monsoon surface
        # reaches 32.4 degC, which clipped 1.6% of cells to flat ramp-max and
        # put part of the field outside what an isovalue could even select. A
        # fixed range only works if it actually contains the data.
        "range": [8.0, 33.0],
        "contourStep": 2.0,          # one isotherm per 2 degC, every tile
    },
    "so": {
        "label": "Salinity",
        "short": "Salinity",
        "units": "PSU",              # conventional display; see unitsAttr
        # The CF attribute on the variable is "1e-3" (dimensionless practical
        # salinity). PSU is what an oceanographer reads, so PSU is what is
        # shown, and the raw attribute is carried through for provenance.
        "unitsAttr": "1e-3",
        "available": True,
        "rangeMode": "tile",
        "contourStep": None,         # derived per tile — see _nice_step
    },
    "uo": {
        "label": "Currents", "short": "Flow", "units": "m/s", "available": False,
        "rangeMode": "fixed", "range": [-1.5, 1.5], "contourStep": 0.5,
    },
}

# Contour intervals come off a ladder of round numbers so the legend always
# reads as a quantity a person would choose. A fixed interval cannot work for a
# per-tile range: 0.25 PSU is 15 lines on the Bay tile and 100 on a plume tile.
NICE_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0]


def _nice_step(span: float, target: int = 10) -> float:
    """The ladder value giving closest to `target` contours across `span`."""
    if not np.isfinite(span) or span <= 0:
        return NICE_STEPS[0]
    want = span / target
    return min(NICE_STEPS, key=lambda s: abs(np.log(s) - np.log(want)))


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

    spec = VARIABLES[variable]
    raw = da.values.astype("float64")                 # NaN = land / below seafloor
    valid = np.isfinite(raw)
    if not valid.any():
        raise ValueError(f"{variable}: tile has no valid cells")
    data_min, data_max = float(np.nanmin(raw)), float(np.nanmax(raw))

    if spec["rangeMode"] == "tile":
        # The tile's own extent, snapped OUTWARD to a quarter unit so the
        # colorbar ticks are round and nothing is ever clipped.
        vmin = float(np.floor(data_min * 4) / 4)
        vmax = float(np.ceil(data_max * 4) / 4)
        if vmax - vmin < 0.25:                        # a near-uniform tile
            vmin, vmax = vmin - 0.125, vmax + 0.125
    else:
        vmin, vmax = spec["range"]

    contour_step = spec["contourStep"] or _nice_step(vmax - vmin)

    # The stylized top face expands contrast around the SURFACE value, so it
    # needs the surface, not the extreme. For thetao the two nearly coincide
    # (warmest water is at the top); for so they do not — the surface is the
    # FRESHEST water, 1.82 PSU from dataMax on the Bay tile, 48% of its whole
    # span — and centring on dataMax renders the lid flat.
    surf = raw[0][np.isfinite(raw[0])]
    surface_median = float(np.median(surf)) if surf.size else float(np.median(raw[valid]))

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
            "variableLabel": spec["label"],
            "variableShort": spec["short"],
            "units": spec["units"],
            "unitsAttr": spec.get("unitsAttr"),
            "valueMin": vmin, "valueMax": vmax,
            "rangeMode": spec["rangeMode"],
            "contourStep": float(contour_step),
            "dataMin": data_min, "dataMax": data_max,
            "surfaceMedian": surface_median,
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


# --------------------------------------------------------------------------
# currents (uo/vo) — a VECTOR pair, not a scalar field
# --------------------------------------------------------------------------
# Deliberately NOT the RG8 path above. That encoding exists so a scalar can be
# a GPU texture with a validity channel; currents are integrated on the CPU by
# the streamline tracer, with no shader in the path, so 8-bit quantisation
# would buy nothing and RK2 compounds per-step error over ~34 steps. Measured
# on the Bengal tile, +/-1.5 m/s gives only ~21 codes across the median speed.
#
# float32 with NaN preserved as the mask. No dilate-fill: an invented velocity
# at a coastline would bend a streamline into the land rather than stop it, so
# the tracer must be able to SEE the boundary. NaN is that signal.
CURRENT_VARS = ("uo", "vo")


def build_currents(nc_paths, dates, max_depth_m: float = 500.0) -> dict:
    """Merge GLORYS uo/vo tiles into one float32 field per date.

    Layout per date: (levels, lat, lon, 2) C-order, [..., 0] = u, [..., 1] = v,
    metres/second, NaN where land or below seafloor.
    """
    ds = xr.open_mfdataset([str(p) for p in nc_paths], combine="by_coords",
                           decode_timedelta=True) if len(nc_paths) > 1 \
        else xr.open_dataset(str(nc_paths[0]), decode_timedelta=True)
    ds = ds.sortby("time")

    have = np.datetime_as_string(ds["time"].values, unit="D").tolist()
    missing = [d for d in dates if d not in have]
    if missing:
        raise ValueError(f"dates absent from the fetched tiles: {missing}")

    depth = ds["depth"].values.astype("float64")
    keep = depth <= max_depth_m + 1e-6
    depth = depth[keep]
    lat = ds["latitude"].values.astype("float64")
    lon = ds["longitude"].values.astype("float64")

    fields, stats = {}, []
    for d in dates:
        t = have.index(d)
        u = ds["uo"].isel(time=t).values[keep].astype("float32")
        v = ds["vo"].isel(time=t).values[keep].astype("float32")
        assert u.shape == (len(depth), len(lat), len(lon)), u.shape
        arr = np.empty((*u.shape, 2), "float32")
        arr[..., 0] = u
        arr[..., 1] = v
        fields[d] = np.ascontiguousarray(arr)
        sp = np.sqrt(u.astype("float64") ** 2 + v.astype("float64") ** 2)
        stats.append(sp[np.isfinite(sp)])

    allsp = np.concatenate(stats)
    return {
        "fields": fields,
        "meta": {
            "dates": list(dates),
            "W": len(lon), "D": len(lat), "levels": len(depth),
            "depthLevels": [float(x) for x in depth],
            "lonMin": float(lon[0]), "lonMax": float(lon[-1]),
            "latMin": float(lat[0]), "latMax": float(lat[-1]),
            "units": "m/s",
            "variables": list(CURRENT_VARS),
            "source": SOURCE_NAME,
            "datasetId": DATASET_ID,
            "validFraction": float(np.isfinite(stats[0]).size / (len(depth) * len(lat) * len(lon))),
            "speedMean": float(allsp.mean()),
            "speedMedian": float(np.median(allsp)),
            "speedP99": float(np.percentile(allsp, 99)),
            "speedMax": float(allsp.max()),
        },
    }


def fetch_subset_range(bbox: dict, date_from: str, date_to: str, variables: list,
                       out_nc, username: str, password: str,
                       max_depth_m: float = 500.0):
    """Multi-date, multi-variable subset in ONE call.

    fetch_subset() above passes a single variable and the same date twice; the
    Copernicus API takes a list and a real range, which is how the whole
    animation window and both current components arrive as one request instead
    of 16. Measured on the Bengal tile: 8 dates x uo,vo = 40 s, 4.7 MB.
    """
    import copernicusmarine
    out_nc = str(out_nc)
    copernicusmarine.subset(
        dataset_id=DATASET_ID,
        variables=list(variables),
        start_datetime=f"{date_from}T00:00:00",
        end_datetime=f"{date_to}T00:00:00",
        minimum_depth=0, maximum_depth=max_depth_m,
        output_directory=out_nc.rsplit("/", 1)[0] if "/" in out_nc else ".",
        output_filename=out_nc.rsplit("/", 1)[-1],
        overwrite=True, username=username, password=password,
        minimum_longitude=bbox["lon_min"], maximum_longitude=bbox["lon_max"],
        minimum_latitude=bbox["lat_min"], maximum_latitude=bbox["lat_max"],
    )
    return out_nc
