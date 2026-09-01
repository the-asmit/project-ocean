"""Argo adapter — real floats from the Argo GDAC via Ifremer ERDDAP.

Replaces the frontend's mock ObservationSource. Two datasets are used:

  ArgoFloats-index   one row per PROFILE: file path, date, position, DAC.
                     Cheap; this is what the marker list comes from.
  ArgoFloats         the measurements: pres / temp / psal plus QC flags.

Verified 2026-08-31 against the live service (P7, do not re-guess):
  * The index `file` path is `<dac>/<wmo>/profiles/<R|D><wmo>_<cycle>.nc`, so
    the WMO, the cycle and the DATA MODE are all readable without opening it.
    R = real-time (automated QC only), D = delayed-mode (scientist adjusted).
  * `institution` in the index is the DAC code, not the float's owner.
  * A query matching nothing returns HTTP 404 with an ERDDAP error body, NOT
    an empty table. That is a normal "no floats here" answer and must not be
    surfaced as a failure.
  * ERDDAP sends no CORS headers, which is why this is proxied server-side
    rather than fetched from the browser.

FLOATS DO NOT PROFILE DAILY. An Argo cycle is ~10 days, so asking for one
date almost always returns nothing: the demo tile has 5 floats within +/-10
days of 2026-06-11 and ZERO on 2026-06-11 itself. Every query here is a
window, and the caller is expected to disclose the real profile date.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

ERDDAP = "https://erddap.ifremer.fr/erddap/tabledap"
SOURCE_NAME = "Argo GDAC"
SOURCE_URL = "https://data-argo.ifremer.fr"

# Data Assembly Centres, for provenance. INCOIS runs the Indian Ocean one,
# which is where most floats in this basin come from.
DACS = {
    "AO": "AOML, USA", "IN": "INCOIS, India", "IF": "Coriolis/Ifremer, France",
    "HZ": "CSIO, China", "JA": "JMA, Japan", "BO": "BODC, UK", "CS": "CSIRO, Australia",
    "KM": "KMA, Korea", "KO": "KORDI, Korea", "ME": "MEDS, Canada", "NM": "NMDIS, China",
}

# Argo reference table 2. 1/2 are usable as-is, 5 is adjusted, 8 interpolated;
# 3/4 are bad and 9 is missing. Anything not in KEEP is dropped and counted.
QC_KEEP = {"1", "2", "5", "8"}


def _get(dataset: str, query: str, timeout: float = 90.0):
    """One ERDDAP tabledap request. Returns rows + column index, or None when
    the query legitimately matches nothing.

    `query` must arrive percent-encoded: ERDDAP rejects a literal > < or " in
    the query string with a 400.
    """
    url = f"{ERDDAP}/{dataset}.json?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": "Ocean-Viz/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            t = json.loads(r.read().decode("utf-8"))["table"]
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None                      # "no matching results" — not an error
        raise
    return t["rows"], {c: i for i, c in enumerate(t["columnNames"])}


def _box(bbox: dict, date_from: str, date_to: str, time_var: str = "date") -> str:
    return "&".join([
        f"{time_var}>={date_from}T00:00:00Z", f"{time_var}<={date_to}T23:59:59Z",
        f"latitude>={bbox['lat_min']}", f"latitude<={bbox['lat_max']}",
        f"longitude>={bbox['lon_min']}", f"longitude<={bbox['lon_max']}",
    ])


def list_floats(bbox: dict, date_from: str, date_to: str) -> list[dict]:
    """Every Argo profile in the box and window, grouped into one entry per
    float — the profile nearest the middle of the window represents it."""
    cols = "file,date,latitude,longitude,institution,profiler_type"
    got = _get("ArgoFloats-index",
               urllib.parse.quote(f"{cols}&{_box(bbox, date_from, date_to)}", safe="&=,/"))
    if got is None:
        return []
    rows, ix = got

    by_float: dict[str, list[dict]] = {}
    for r in rows:
        path = r[ix["file"]]
        parts = path.split("/")
        if len(parts) < 4:
            continue
        dac_dir, wmo, _, fname = parts[0], parts[1], parts[2], parts[-1]
        mode = fname[0] if fname[:1] in ("R", "D") else "?"
        try:
            cycle = int(fname.rsplit("_", 1)[-1].split(".")[0].rstrip("D"))
        except ValueError:
            continue
        by_float.setdefault(wmo, []).append({
            "wmo": wmo, "cycle": cycle, "file": path,
            "date": r[ix["date"]][:10], "time": r[ix["date"]],
            "lat": float(r[ix["latitude"]]), "lon": float(r[ix["longitude"]]),
            "dac": r[ix["institution"]], "dacLabel": DACS.get(r[ix["institution"]], r[ix["institution"]]),
            "dataMode": mode, "profilerType": r[ix["profiler_type"]],
            "dacDir": dac_dir,
        })

    out = []
    for wmo, profs in by_float.items():
        profs.sort(key=lambda p: p["date"])
        # The float's marker sits at its LAST profile in the window; a float
        # that moved is one object, not several, and the newest fix is the
        # least stale place to draw it.
        rep = profs[-1]
        out.append({**rep, "id": f"{wmo}-{rep['cycle']}",
                    "profileCount": len(profs),
                    "cycles": [p["cycle"] for p in profs],
                    "dates": [p["date"] for p in profs]})
    out.sort(key=lambda f: f["wmo"])
    return out


def get_profile(wmo: str, cycle: int) -> dict:
    """One float profile: pressure, temperature and salinity, QC-filtered."""
    cols = ("platform_number,cycle_number,time,latitude,longitude,"
            "pres,temp,psal,pres_qc,temp_qc,psal_qc,data_mode")
    q = f'{cols}&platform_number="{wmo}"&cycle_number={int(cycle)}'
    got = _get("ArgoFloats", urllib.parse.quote(q, safe="&=,/"))
    if got is None:
        return {"wmo": wmo, "cycle": cycle, "levels": [], "reason": "no such profile"}
    rows, ix = got

    levels, dropped = [], 0
    for r in rows:
        pres, temp, psal = r[ix["pres"]], r[ix["temp"]], r[ix["psal"]]
        if pres is None:
            continue
        if r[ix["pres_qc"]] not in QC_KEEP:
            dropped += 1
            continue
        t_ok = temp is not None and r[ix["temp_qc"]] in QC_KEEP
        s_ok = psal is not None and r[ix["psal_qc"]] in QC_KEEP
        if not t_ok and not s_ok:
            dropped += 1
            continue
        levels.append({
            # Pressure in decibars is within 1% of depth in metres over this
            # range; the model's own axis is depth, so the two are compared
            # directly and the approximation is disclosed rather than hidden.
            "depthM": float(pres),
            "thetao": float(temp) if t_ok else None,
            "so": float(psal) if s_ok else None,
        })
    levels.sort(key=lambda x: x["depthM"])

    head = rows[0] if rows else None
    return {
        "wmo": wmo, "cycle": int(cycle),
        "time": head[ix["time"]] if head else None,
        "date": head[ix["time"]][:10] if head else None,
        "lat": float(head[ix["latitude"]]) if head else None,
        "lon": float(head[ix["longitude"]]) if head else None,
        "dataMode": head[ix["data_mode"]] if head else "?",
        "levels": levels,
        "levelsDropped": dropped,
        "source": SOURCE_NAME,
        "sourceUrl": SOURCE_URL,
    }
