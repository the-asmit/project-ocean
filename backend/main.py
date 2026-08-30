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


def _region(name: str) -> dict:
    if name not in REGIONS:
        raise HTTPException(404, f"unknown region '{name}'; have {list(REGIONS)}")
    return REGIONS[name]


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
    key = f"bathy_{region}"
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
    key = f"vol_{region}_{date}_{variable}"
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
        "defaultRegion": "coastal",
        "defaultDate": DEFAULT_DATE,
        "variables": glorys.VARIABLES,
    }


@app.get("/dataset")
def dataset(region: str = "coastal", date: str = DEFAULT_DATE, variable: str = "thetao"):
    """One manifest with everything the client needs to build its textures."""
    vmeta = json.loads((_volume_dir(region, date, variable) / "meta.json").read_text())
    bmeta = json.loads((_bathy_dir(region) / "meta.json").read_text())
    return {
        "region": region,
        "regionLabel": REGIONS[region]["label"],
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
    nc = RAW / f"vol_{region}_{date}_{variable}.nc"
    res = glorys.sample_point(nc, variable, lat, lon, depth)
    return {
        "lat": lat, "lon": lon, "depth": depth,
        "variable": variable, "date": date, "region": region,
        "source": glorys.SOURCE_NAME, "datasetId": glorys.DATASET_ID,
        **res,
    }
