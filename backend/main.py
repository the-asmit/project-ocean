"""
Ocean-Viz backend — FastAPI.

Serves the proven GLORYS + bathymetry pipeline as real endpoints, with a
filesystem cache keyed by region + date + variable so repeated requests never
re-hit Copernicus Marine.

    GET /health
    GET /regions
    GET /dataset?region=&date=&variable=     JSON manifest (dims, LUT, ranges)
    GET /slice/volume?region=&date=&variable=  binary RG8 3-D field
    GET /bathymetry?region=                    binary f32 seafloor world-Y grid
    GET /bathymetry/height?region=             binary u8 seafloor mask texture
    GET /point?region=&date=&variable=&lat=&lon=&depth=   JSON point query

Cache layout:
    cache/raw/<key>.nc              raw Copernicus downloads
    cache/derived/<key>/*.bin|json  derived render products
"""
from __future__ import annotations

import json
import os
import pathlib
import threading

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from adapters import bathymetry, glorys

ROOT = pathlib.Path(__file__).parent
CACHE = ROOT / "cache"
RAW = CACHE / "raw"
DERIVED = CACHE / "derived"
for d in (RAW, DERIVED):
    d.mkdir(parents=True, exist_ok=True)


def _load_env():
    """Read CMEMS creds from backend/.env or the project root .env."""
    for p in (ROOT / ".env", ROOT.parent / ".env", ROOT.parent / "spike-real-data" / ".env"):
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()
CMEMS_USER = os.environ.get("CMEMS_USERNAME", "")
CMEMS_PASS = os.environ.get("CMEMS_PASSWORD", "")

# Named regions. `coastal` is the validated tile: Sri Lanka + shelf + open Bay,
# the one that actually exercises land masking and shelf geometry.
REGIONS = {
    "coastal": {
        "label": "Sri Lanka shelf & Bay of Bengal",
        "lon_min": 79.5, "lon_max": 84.5, "lat_min": 6.0, "lat_max": 11.0,
    },
    "open": {
        "label": "Central Bay of Bengal (deep)",
        "lon_min": 85.0, "lon_max": 90.0, "lat_min": 10.0, "lat_max": 15.0,
    },
    # The east-coast tile: Andhra/Odisha coastline, its shelf, the slope, and
    # the deep western Bay. `open` is all abyssal plain with ZERO land cells,
    # so it can carry neither a coastline on the map nor shelf structure on the
    # block's cut faces.
    "bengal": {
        "label": "Bay of Bengal — India east coast",
        "lon_min": 79.5, "lon_max": 85.5, "lat_min": 12.0, "lat_max": 18.0,
    },
}
DEFAULT_DATE = "2020-01-01"

# Wide bathymetry-only tile the client draws the region picker on. No volume is
# ever built for it — the minimap needs land/depth and nothing else.
CONTEXT_REGION = {
    "label": "North Indian Ocean",
    "lon_min": 68.0, "lon_max": 98.0, "lat_min": 0.0, "lat_max": 26.0,
}

# Selection limits. The validated tiles are 5-6 deg on a side; below ~1.5 deg a
# 1/12 deg tile has too few cells to interpolate, and above ~10 deg the derive
# step and the browser-side 3-D texture both get unreasonable.
MIN_SPAN_DEG = 1.5
MAX_SPAN_DEG = 10.0

app = FastAPI(title="Ocean-Viz API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

_locks: dict[str, threading.Lock] = {}
_lock_guard = threading.Lock()


def _lock(key: str) -> threading.Lock:
    with _lock_guard:
        return _locks.setdefault(key, threading.Lock())


def _canon(spec: str) -> str:
    """Canonical cache key for a region spec.

    Named regions pass through. Free bboxes arrive as
    `bbox:lonMin,lonMax,latMin,latMax` and are rounded to 2 dp so the same
    drawn rectangle always resolves to the same cached tile.
    """
    if not spec.startswith("bbox:"):
        return spec
    try:
        a, b, c, d = (float(x) for x in spec[5:].split(","))
    except ValueError:
        raise HTTPException(400, f"malformed bbox '{spec}'; want bbox:lonMin,lonMax,latMin,latMax")
    lon_min, lon_max = round(min(a, b), 2), round(max(a, b), 2)
    lat_min, lat_max = round(min(c, d), 2), round(max(c, d), 2)
    return f"bbox:{lon_min},{lon_max},{lat_min},{lat_max}"


def _region(spec: str) -> dict:
    if spec == "context":
        return CONTEXT_REGION
    if not spec.startswith("bbox:"):
        if spec not in REGIONS:
            raise HTTPException(404, f"unknown region '{spec}'; have {list(REGIONS)}")
        return REGIONS[spec]

    lon_min, lon_max, lat_min, lat_max = (float(x) for x in _canon(spec)[5:].split(","))
    dlon, dlat = lon_max - lon_min, lat_max - lat_min
    if dlon < MIN_SPAN_DEG or dlat < MIN_SPAN_DEG:
        raise HTTPException(
            400, f"selection too small ({dlon:.2f}x{dlat:.2f} deg); minimum is "
                 f"{MIN_SPAN_DEG} deg on each side")
    if dlon > MAX_SPAN_DEG or dlat > MAX_SPAN_DEG:
        raise HTTPException(
            400, f"selection too large ({dlon:.2f}x{dlat:.2f} deg); maximum is "
                 f"{MAX_SPAN_DEG} deg on each side")
    if not (-180 <= lon_min < lon_max <= 180 and -80 <= lat_min < lat_max <= 90):
        raise HTTPException(400, "selection outside the model domain")

    def fmt(v, pos, neg):
        return f"{abs(v):.1f}°{pos if v >= 0 else neg}"

    return {
        "label": f"{fmt(lat_min,'N','S')}-{fmt(lat_max,'N','S')} "
                 f"{fmt(lon_min,'E','W')}-{fmt(lon_max,'E','W')}",
        "lon_min": lon_min, "lon_max": lon_max,
        "lat_min": lat_min, "lat_max": lat_max,
    }


def _slug(spec: str) -> str:
    """Filesystem-safe cache key."""
    return _canon(spec).replace(":", "_").replace(",", "_").replace("-", "m")


def _bin(data: np.ndarray, filename: str) -> Response:
    return Response(
        content=data.tobytes(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "public, max-age=86400",
        },
    )


# --------------------------------------------------------------------------
# cache builders
# --------------------------------------------------------------------------
def _bathy_dir(region: str) -> pathlib.Path:
    key = f"bathy_{_slug(region)}"
    out = DERIVED / key
    with _lock(key):
        if (out / "meta.json").exists():
            return out
        nc = RAW / f"{key}.nc"
        if not nc.exists():
            if not CMEMS_USER:
                raise HTTPException(503, "CMEMS credentials missing and no cached tile")
            bathymetry.fetch_static(_region(region), nc, CMEMS_USER, CMEMS_PASS)
        built = bathymetry.build(nc)
        out.mkdir(parents=True, exist_ok=True)
        built["bathy_f32"].astype("<f4").tofile(out / "bathy.bin")
        built["height_u8"].tofile(out / "height.bin")
        (out / "meta.json").write_text(json.dumps(built["meta"], indent=2))
    return out


def _volume_dir(region: str, date: str, variable: str) -> pathlib.Path:
    if variable not in glorys.VARIABLES:
        raise HTTPException(404, f"unknown variable '{variable}'")
    if not glorys.VARIABLES[variable]["available"]:
        raise HTTPException(
            501, f"variable '{variable}' has no data wired up yet (coming soon)")
    key = f"vol_{_slug(region)}_{date}_{variable}"
    out = DERIVED / key
    with _lock(key):
        if (out / "meta.json").exists():
            return out
        nc = RAW / f"{key}.nc"
        if not nc.exists():
            if not CMEMS_USER:
                raise HTTPException(503, "CMEMS credentials missing and no cached tile")
            glorys.fetch_subset(_region(region), date, variable, nc, CMEMS_USER, CMEMS_PASS)
        bmeta = json.loads((_bathy_dir(region) / "meta.json").read_text())
        built = glorys.build(nc, variable, bmeta["bathyMaxM"])
        out.mkdir(parents=True, exist_ok=True)
        built["field_rg8"].tofile(out / "field.bin")
        (out / "meta.json").write_text(json.dumps(built["meta"], indent=2))
    return out


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------
@app.get("/health")
def health():
    return {
        "ok": True,
        "credentials": bool(CMEMS_USER),
        "cachedRaw": sorted(p.name for p in RAW.glob("*.nc")),
        "cachedDerived": sorted(p.name for p in DERIVED.iterdir() if p.is_dir()),
    }


@app.get("/regions")
def regions():
    return {
        "regions": {k: {**v, "label": v["label"]} for k, v in REGIONS.items()},
        "context": CONTEXT_REGION,
        "selection": {"minSpanDeg": MIN_SPAN_DEG, "maxSpanDeg": MAX_SPAN_DEG},
        "defaultRegion": "bengal",
        "defaultDate": DEFAULT_DATE,
        "variables": glorys.VARIABLES,
    }


@app.get("/dataset")
def dataset(region: str = "coastal", date: str = DEFAULT_DATE, variable: str = "thetao"):
    """One manifest with everything the client needs to build its textures."""
    vmeta = json.loads((_volume_dir(region, date, variable) / "meta.json").read_text())
    bmeta = json.loads((_bathy_dir(region) / "meta.json").read_text())
    return {
        "region": _canon(region),
        "regionLabel": _region(region)["label"],
        "date": date,
        "bbox": _region(region),
        "volume": vmeta,
        "bathymetry": bmeta,
        "variables": glorys.VARIABLES,
        "urls": {
            "volume": f"/slice/volume?region={region}&date={date}&variable={variable}",
            "bathymetry": f"/bathymetry?region={region}",
            "height": f"/bathymetry/height?region={region}",
        },
    }


@app.get("/slice/volume")
def slice_volume(region: str = "coastal", date: str = DEFAULT_DATE, variable: str = "thetao"):
    d = _volume_dir(region, date, variable)
    return _bin(np.fromfile(d / "field.bin", np.uint8), "field.bin")


@app.get("/bathymetry/meta")
def bathymetry_meta(region: str = "coastal"):
    """Bathymetry manifest alone — the region picker's basemap needs land and
    depth, never a volume."""
    return json.loads((_bathy_dir(region) / "meta.json").read_text())


@app.get("/bathymetry")
def bathymetry_grid(region: str = "coastal"):
    d = _bathy_dir(region)
    return _bin(np.fromfile(d / "bathy.bin", np.float32), "bathy.bin")


@app.get("/bathymetry/height")
def bathymetry_height(region: str = "coastal"):
    d = _bathy_dir(region)
    return _bin(np.fromfile(d / "height.bin", np.uint8), "height.bin")


@app.get("/point")
def point(
    lat: float = Query(...), lon: float = Query(...), depth: float = Query(0.0),
    region: str = "coastal", date: str = DEFAULT_DATE, variable: str = "thetao",
):
    """On-demand point query straight from the source NetCDF."""
    _volume_dir(region, date, variable)          # ensures the tile is cached
    nc = RAW / f"vol_{_slug(region)}_{date}_{variable}.nc"
    res = glorys.sample_point(nc, variable, lat, lon, depth)
    return {
        "lat": lat, "lon": lon, "depth": depth,
        "variable": variable, "date": date, "region": region,
        "source": glorys.SOURCE_NAME, "datasetId": glorys.DATASET_ID,
        **res,
    }
