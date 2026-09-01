"""Glider adapter — real tracks from the OceanGliders GDAC via Ifremer ERDDAP.

A glider is NOT a station. It flies a sawtooth: diving and climbing repeatedly
while drifting, so its data is a PATH through the volume rather than a column
at a point. That is why it gets its own adapter and its own geometry instead of
being folded into the Argo float list.

Verified 2026-08-31 against the live service (P7, do not re-guess):
  * dataset `OceanGlidersGDACTrajectories`, variables TEMP / PSAL / PRES plus
    position and time. Coverage ends 2026-06-23.
  * The QC columns (TEMP_QC, PSAL_QC, ...) are present but NULL throughout the
    Bay of Bengal deployments. There is no QC to filter on, and the UI must say
    so rather than implying the data has been screened.
  * A query matching nothing returns HTTP 404, which is a normal "no gliders
    here" answer.
  * Whole-deployment volume, measured on Humpback_504: 286,098 rows / 28 MB of
    CSV in 12.6 s. Too much to hand a browser, cheap enough to fetch once
    server-side and decimate exactly.
  * The five deployments in this basin are July 2016 at ~8 N, 85-89 E. There is
    NO glider anywhere near the 2026-06 demo tile, which is why the layer has a
    real empty state and a preset that travels to where the data is.

DECIMATION keeps the turning points. A glider's shape is its dive apices; a
plain every-k-th-row stride clips them and flattens the sawtooth into a smear.
Segments are split at each apex and resampled within, so every apex survives
exactly as measured.
"""
from __future__ import annotations

import csv
import io
import json
import urllib.error
import urllib.parse
import urllib.request

ERDDAP = "https://erddap.ifremer.fr/erddap/tabledap"
DATASET = "OceanGlidersGDACTrajectories"
SOURCE_NAME = "OceanGliders GDAC"
SOURCE_URL = "https://erddap.ifremer.fr/erddap/tabledap/OceanGlidersGDACTrajectories.html"

# An apex must be this many decibars clear of its neighbours to count as a real
# turn rather than sensor noise or a brief hold.
APEX_PROMINENCE_DBAR = 25.0
TARGET_POINTS = 4000


def _url(ext: str, query: str) -> str:
    return f"{ERDDAP}/{DATASET}.{ext}?{urllib.parse.quote(query, safe='&=,/')}"


def _fetch(ext: str, query: str, timeout: float = 240.0):
    req = urllib.request.Request(_url(ext, query), headers={"User-Agent": "Ocean-Viz/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None                      # no matching results — not an error
        raise


def list_tracks(bbox: dict, date_from: str, date_to: str) -> list[dict]:
    """Deployments crossing the box during the window, with their real extents.

    orderByMinMax returns the first and last row of each group, so one request
    yields each deployment's date range AND its start/end position.
    """
    q = ("platform_deployment,time,latitude,longitude"
         f"&time>={date_from}T00:00:00Z&time<={date_to}T23:59:59Z"
         f"&latitude>={bbox['lat_min']}&latitude<={bbox['lat_max']}"
         f"&longitude>={bbox['lon_min']}&longitude<={bbox['lon_max']}"
         '&orderByMinMax("platform_deployment,time")')
    body = _fetch("json", q, timeout=180.0)
    if body is None:
        return []
    t = json.loads(body)["table"]
    ix = {c: i for i, c in enumerate(t["columnNames"])}

    grouped: dict[str, list] = {}
    for r in t["rows"]:
        grouped.setdefault(r[ix["platform_deployment"]], []).append(r)

    out = []
    for name, rows in sorted(grouped.items()):
        rows.sort(key=lambda r: r[ix["time"]])
        a, b = rows[0], rows[-1]
        out.append({
            "id": name,
            "deployment": name,
            "dateFrom": a[ix["time"]][:10],
            "dateTo": b[ix["time"]][:10],
            "startLat": a[ix["latitude"]], "startLon": a[ix["longitude"]],
            "endLat": b[ix["latitude"]], "endLon": b[ix["longitude"]],
            "source": SOURCE_NAME,
        })
    return out


def _apexes(pres: list[float], prom: float = APEX_PROMINENCE_DBAR) -> list[int]:
    """Indices where the glider turns around.

    A zigzag walk: hold the running extreme in the direction of travel and
    commit a turn only once the pressure has retraced by `prom`. That way a
    wobble on a slow limb cannot manufacture a dive, while every real apex is
    reported at the exact sample where it occurred — no smoothing, no shifting.
    """
    n = len(pres)
    if n < 3:
        return list(range(n))
    turns = [0]
    direction = 0                      # +1 descending, -1 ascending, 0 undecided
    ext = 0                            # index of the running extreme
    for i in range(1, n):
        p = pres[i]
        if direction > 0:
            if p > pres[ext]:
                ext = i
            elif pres[ext] - p >= prom:
                turns.append(ext); direction = -1; ext = i
        elif direction < 0:
            if p < pres[ext]:
                ext = i
            elif p - pres[ext] >= prom:
                turns.append(ext); direction = 1; ext = i
        else:
            # Undecided: the first sample to clear the threshold either way sets
            # the direction, and is by construction the extreme so far.
            if p - pres[ext] >= prom:
                direction = 1; ext = i
            elif pres[ext] - p >= prom:
                direction = -1; ext = i
    if turns[-1] != n - 1:
        turns.append(n - 1)
    return turns


def _decimate(rows: list[dict], target: int = TARGET_POINTS) -> tuple[list[dict], dict]:
    """Thin the track to ~`target` points WITHOUT losing any dive apex."""
    pres = [r["pres"] for r in rows]
    turns = _apexes(pres)
    if len(turns) < 2:
        step = max(1, len(rows) // target)
        return rows[::step], {"dives": 0, "apexesKept": 0, "method": "stride (no dives found)"}

    # Budget the remaining points across segments in proportion to their length.
    body = max(0, target - len(turns))
    total = max(1, turns[-1] - turns[0])
    keep: set[int] = set(turns)                 # every apex, exactly as measured
    for a, b in zip(turns, turns[1:]):
        span = b - a
        if span < 2:
            continue
        n = max(1, round(body * span / total))
        for k in range(1, n + 1):
            keep.add(a + max(1, min(span - 1, round(span * k / (n + 1)))))
    idx = sorted(keep)
    return [rows[i] for i in idx], {
        "dives": len(turns) - 1,
        "apexesKept": len(turns),
        "method": f"dive-segmented, apices preserved (prominence {APEX_PROMINENCE_DBAR:g} dbar)",
    }


def get_track(deployment: str, max_depth_m: float | None = None) -> dict:
    """One deployment's full track, decimated. CSV because it is half the size
    of JSON for the same numbers and this is the heavy request."""
    q = ("platform_deployment,time,latitude,longitude,PRES,TEMP,PSAL"
         f'&platform_deployment="{deployment}"')
    body = _fetch("csv", q)
    if body is None:
        return {"deployment": deployment, "points": [], "reason": "no such deployment"}

    rd = csv.reader(io.StringIO(body))
    header = next(rd)
    next(rd, None)                                     # ERDDAP units row
    ci = {c: i for i, c in enumerate(header)}

    def num(v):
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        return None if f != f else f          # ERDDAP writes a literal "NaN"

    rows = []
    for r in rd:
        lat, lon, pres = num(r[ci["latitude"]]), num(r[ci["longitude"]]), num(r[ci["PRES"]])
        if lat is None or lon is None or pres is None:
            continue
        rows.append({"time": r[ci["time"]], "lat": lat, "lon": lon, "pres": pres,
                     "thetao": num(r[ci["TEMP"]]), "so": num(r[ci["PSAL"]])})
    if not rows:
        return {"deployment": deployment, "points": [], "reason": "no positioned rows"}
    rows.sort(key=lambda r: r["time"])

    kept, stats = _decimate(rows)
    pres_all = [r["pres"] for r in rows]
    temps = [r["thetao"] for r in kept if r["thetao"] is not None]
    sals = [r["so"] for r in kept if r["so"] is not None]

    return {
        "deployment": deployment,
        "points": kept,
        "meta": {
            "source": SOURCE_NAME, "sourceUrl": SOURCE_URL,
            "rowsRaw": len(rows), "rowsKept": len(kept),
            **stats,
            "dateFrom": rows[0]["time"][:10], "dateTo": rows[-1]["time"][:10],
            "maxPresDbar": max(pres_all), "minPresDbar": min(pres_all),
            # The model stops at ~454 m; the glider does not. Saying how much of
            # the track runs past the volume's own extent is the honest way to
            # draw a ribbon that leaves the data band.
            "deeperThanModel": (None if max_depth_m is None
                                else sum(1 for p in pres_all if p > max_depth_m) / len(pres_all)),
            "modelMaxDepthM": max_depth_m,
            "thetaoRange": [min(temps), max(temps)] if temps else None,
            "soRange": [min(sals), max(sals)] if sals else None,
            # Verified null throughout these deployments — see module docstring.
            "qcAvailable": False,
        },
    }
