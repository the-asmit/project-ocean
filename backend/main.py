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
    GET /argo/floats?region=&date=            real Argo floats near the tile
    GET /argo/profile?wmo=&cycle=             one real Argo profile
    GET /gliders/tracks?region=&date=         real glider deployments in the tile
    GET /gliders/track?deployment=&region=    one decimated glider track

Cache layout:
    cache/raw/<key>.nc              raw Copernicus downloads
    cache/derived/<key>/*.bin|json  derived render products
"""
from __future__ import annotations

import datetime
import json
import os
import pathlib
import threading

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from adapters import argo, bathymetry, gliders, glorys

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
# The demo date. GLORYS12V1 reanalysis runs 1993-01-01 -> 2026-06-23 (verified
# against the store's own time axis, not the catalogue), so this sits a few
# days inside the archive edge rather than on it — dates at the very end are
# occasionally revised. The currents window runs DEFAULT_DATE + 8 days.
DEFAULT_DATE = "2026-06-11"

# Wide bathymetry-only tile the client draws the region picker on. No volume is
# ever built for it — the minimap needs land/depth and nothing else.
CONTEXT_REGION = {
    "label": "North Indian Ocean",
    "lon_min": 68.0, "lon_max": 98.0, "lat_min": 0.0, "lat_max": 26.0,
}

# Places worth travelling to, because the data is there and not here.
#
# There is no glider anywhere near the 2026-06 demo tile: the OceanGliders GDAC
# holds exactly five deployments in the whole northern Indian Ocean, all July
# 2016 at ~8 N, 85-89 E. Rather than fake one, the UI offers a labelled jump to
# where the real tracks are. GLORYS covers 1993 onward, so the model tile for
# that date is as real as the demo one.
PRESETS = [
    {
        "id": "gliders-bob-2016",
        "label": "Glider deployment · Bay of Bengal",
        "sub": "5 real glider tracks · July 2016",
        "region": "bbox:85.0,90.0,5.0,10.0",
        "date": "2016-07-08",
        "why": ("Real OceanGliders GDAC tracks. No glider has operated near the "
                "2026-06 demo tile, so this jumps to real historical data — "
                "both the model tile and the glider tracks are measured, at their "
                "own date."),
        "layer": "gliders",
    },
]

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


CURRENT_DAYS = 8          # animation frames; one GLORYS day each


def _current_dates(date: str, days: int = CURRENT_DAYS) -> list[str]:
    d0 = datetime.date.fromisoformat(date)
    return [(d0 + datetime.timedelta(days=i)).isoformat() for i in range(days)]


def _nc_covers(path: pathlib.Path, dates: list[str]) -> bool:
    """Does this raw tile's filename span any of `dates`?

    Names are cur_<region>_<date>.nc or cur_<region>_<from>_<to>.nc, so the
    range is readable without opening the file — worth it because opening every
    candidate is what this check exists to avoid.
    """
    parts = path.stem.split("_")
    stamps = [p for p in parts if len(p) == 10 and p[4] == "-" and p[7] == "-"]
    if not stamps:
        return False
    lo, hi = stamps[0], stamps[-1]
    return any(lo <= d <= hi for d in dates)


def _currents_dir(region: str, date: str, days: int = CURRENT_DAYS) -> pathlib.Path:
    """Real uo/vo for `days` consecutive dates, as float32 with NaN as the mask.

    Same region+date cache keying as _volume_dir, but a separate product: uo/vo
    are a VECTOR pair and never go through the scalar RG8 path or the variable
    picker. One Copernicus call covers the whole range and both components.
    """
    dates = _current_dates(date, days)
    key = f"cur_{_slug(region)}_{date}_{days}d"
    out = DERIVED / key
    with _lock(key):
        if (out / "meta.json").exists():
            return out
        # Only the tiles that actually overlap this window. The bare
        # `cur_<region>_*.nc` glob merged every window ever fetched for the
        # region — with a January 2020 and a June 2026 file on disk that is one
        # open_mfdataset across a six-year gap, to read eight days out of it.
        ncs = [p for p in sorted(RAW.glob(f"cur_{_slug(region)}_*.nc"))
               if _nc_covers(p, dates)]
        if not ncs:
            if not CMEMS_USER:
                raise HTTPException(503, "CMEMS credentials missing and no cached currents")
            nc = RAW / f"cur_{_slug(region)}_{dates[0]}_{dates[-1]}.nc"
            glorys.fetch_subset_range(
                _region(region), dates[0], dates[-1], list(glorys.CURRENT_VARS),
                nc, CMEMS_USER, CMEMS_PASS)
            ncs = [nc]
        built = glorys.build_currents(ncs, dates)
        out.mkdir(parents=True, exist_ok=True)
        for d, arr in built["fields"].items():
            arr.tofile(out / f"{d}.bin")
        (out / "meta.json").write_text(json.dumps(built["meta"], indent=2))
    return out


# --------------------------------------------------------------------------
# in-situ observations (real instruments, proxied and cached)
# --------------------------------------------------------------------------
# Argo floats cycle about every 10 days, so a single date almost always matches
# nothing: the demo tile has five floats within +/-10 days of its date and ZERO
# on the date itself. Everything here is a WINDOW, and the client discloses the
# real profile date against the model date.
OBS_DAYS = 10


def _obs_window(date: str, days: int = OBS_DAYS) -> tuple[str, str]:
    d = datetime.date.fromisoformat(date)
    return ((d - datetime.timedelta(days=days)).isoformat(),
            (d + datetime.timedelta(days=days)).isoformat())


def _obs_cached(key: str, build):
    """Filesystem-cached JSON. These are third-party services; a demo must not
    depend on them staying up, and must not hammer them on every re-render."""
    out = DERIVED / "obs"
    out.mkdir(parents=True, exist_ok=True)
    f = out / f"{key}.json"
    with _lock(key):
        if f.exists():
            return json.loads(f.read_text())
        data = build()
        f.write_text(json.dumps(data))
    return data


@app.get("/argo/floats")
def argo_floats(region: str = "coastal", date: str = DEFAULT_DATE, days: int = OBS_DAYS):
    """Real Argo floats whose profiles fall in this tile and window."""
    d0, d1 = _obs_window(date, days)
    key = f"argo_{_slug(region)}_{date}_{days}d"
    try:
        floats = _obs_cached(key, lambda: argo.list_floats(_region(region), d0, d1))
    except Exception as e:                      # the GDAC is a third party
        raise HTTPException(502, f"Argo GDAC unavailable: {e}") from e
    return {
        "floats": floats, "count": len(floats),
        "region": _canon(region), "date": date,
        "windowFrom": d0, "windowTo": d1, "windowDays": days,
        "source": argo.SOURCE_NAME, "sourceUrl": argo.SOURCE_URL,
    }


@app.get("/argo/profile")
def argo_profile(wmo: str = Query(...), cycle: int = Query(...)):
    """One real Argo profile: pressure, temperature and salinity, QC-filtered."""
    try:
        return _obs_cached(f"argoprof_{wmo}_{cycle}", lambda: argo.get_profile(wmo, cycle))
    except Exception as e:
        raise HTTPException(502, f"Argo GDAC unavailable: {e}") from e


@app.get("/gliders/tracks")
def glider_tracks(region: str = "coastal", date: str = DEFAULT_DATE, days: int = OBS_DAYS):
    """Real glider deployments crossing this tile in this window. An empty list
    is a real answer, and the client says so rather than rendering nothing."""
    d0, d1 = _obs_window(date, days)
    key = f"gliders_{_slug(region)}_{date}_{days}d"
    try:
        tracks = _obs_cached(key, lambda: gliders.list_tracks(_region(region), d0, d1))
    except Exception as e:
        raise HTTPException(502, f"OceanGliders GDAC unavailable: {e}") from e
    return {
        "tracks": tracks, "count": len(tracks),
        "region": _canon(region), "date": date,
        "windowFrom": d0, "windowTo": d1, "windowDays": days,
        "source": gliders.SOURCE_NAME, "sourceUrl": gliders.SOURCE_URL,
    }


@app.get("/gliders/track")
def glider_track(deployment: str = Query(...), region: str = "coastal",
                 date: str = DEFAULT_DATE):
    """One deployment, decimated to a drawable path with every dive apex kept."""
    try:
        vmeta = json.loads((_volume_dir(region, date, "thetao") / "meta.json").read_text())
        max_depth = vmeta["maxDepthM"]
    except Exception:
        max_depth = None
    try:
        return _obs_cached(f"gtrack_{deployment}",
                           lambda: gliders.get_track(deployment, max_depth))
    except Exception as e:
        raise HTTPException(502, f"OceanGliders GDAC unavailable: {e}") from e


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
        "presets": PRESETS,
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


@app.get("/currents/meta")
def currents_meta(region: str = "coastal", date: str = DEFAULT_DATE):
    """Manifest for the real current field: dates, grid, levels, speed stats."""
    return json.loads((_currents_dir(region, date) / "meta.json").read_text())


@app.get("/currents/field")
def currents_field(region: str = "coastal", date: str = DEFAULT_DATE,
                   frame: str = DEFAULT_DATE):
    """One date's (levels, lat, lon, 2) float32 field. NaN = land/below floor."""
    d = _currents_dir(region, date)
    f = d / f"{frame}.bin"
    if not f.exists():
        raise HTTPException(404, f"no current frame for {frame}")
    return _bin(np.fromfile(f, np.float32), f"{frame}.bin")


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
