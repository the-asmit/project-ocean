"""Ground truth for D26 / TCHP, straight off the source NetCDF.

The browser computes both from the 8-bit RG8 volume it already has in memory.
This computes them from the float64 NetCDF the RG8 was baked from, so the
difference between the two is the QUANTISATION COST — measured here rather than
assumed. It also screens candidate tiles/dates for the Cyclone Scenario preset:
a preset is only worth having if the field it lands on actually crosses the
40 kJ/cm2 threshold with visible contrast, and that is a property of the data,
not of the story.

    python verify_tchp.py cache/raw/vol_bbox_85.0_90.0_10.0_16.0_2020-05-16_thetao.nc
"""
from __future__ import annotations

import sys

import numpy as np
import xarray as xr

RHO = 1026.0          # kg/m3   seawater, upper ocean
CP = 3990.0           # J/(kg.degC)
T26 = 26.0
# rho*cp*[degC.m] gives J/m2; 1 J/m2 = 1e-3 kJ / 1e4 cm2 = 1e-7 kJ/cm2
HEAT_PER_DEGC_M = RHO * CP * 1e-7        # kJ/cm2 per degC.m  -> 0.4094
THRESHOLD = 40.0      # kJ/cm2, the cited BoB intensification figure

# the thetao clamp the backend bakes into the RG8 R channel
VMIN, VMAX = 8.0, 33.0


def column(t, z):
    """One (lon,lat) column -> (d26_m, excess_degC_m, censored).

    t, z are the FINITE levels of the column, shallowest first. Returns
    (nan, 0, False) where the surface is not warmer than 26 degC.
    """
    if t.size == 0 or t[0] <= T26:
        return np.nan, 0.0, False

    # from the surface down to the first level: the model's shallowest level is
    # ~0.49 m and there is nothing above it, so it is held constant to z=0
    acc = (t[0] - T26) * z[0]

    for j in range(t.size - 1):
        if t[j + 1] > T26:
            acc += 0.5 * ((t[j] - T26) + (t[j + 1] - T26)) * (z[j + 1] - z[j])
            continue
        # crossing between j and j+1 — linear interpolation, as the spec says
        f = (t[j] - T26) / (t[j] - t[j + 1])
        d26 = z[j] + f * (z[j + 1] - z[j])
        acc += 0.5 * (t[j] - T26) * (d26 - z[j])
        return d26, acc, False

    # never crossed inside what the column carries: the warm layer runs past
    # the deepest valid level (the seafloor, or the volume's own extent)
    return z[-1], acc, True


def field(T, depth):
    """T (H, D, W) with NaN outside water, depth (H,) ascending metres."""
    H, D, W = T.shape
    d26 = np.full((D, W), np.nan)
    excess = np.full((D, W), np.nan)
    censored = np.zeros((D, W), bool)
    for k in range(D):
        for i in range(W):
            col = T[:, k, i]
            ok = np.isfinite(col)
            if not ok[0]:
                continue                      # land
            a, b, c = column(col[ok], depth[ok])
            d26[k, i], excess[k, i], censored[k, i] = a, b, c
    return d26, excess * HEAT_PER_DEGC_M, censored


def quantise(T):
    """The exact round-trip the RG8 R channel performs on thetao."""
    q = np.round(np.clip((T - VMIN) / (VMAX - VMIN), 0, 1) * 255)
    return VMIN + (q / 255.0) * (VMAX - VMIN)


def pct(a, p):
    return float(np.nanpercentile(a, p)) if np.isfinite(a).any() else float("nan")


def ascii_map(a, lo, hi, rows=16, cols=44):
    ramp = " .:-=+*#%@"
    D, W = a.shape
    out = []
    for r in range(rows):
        k = int((rows - 1 - r) / max(1, rows - 1) * (D - 1))   # north at the top
        line = ""
        for c in range(cols):
            i = int(c / max(1, cols - 1) * (W - 1))
            v = a[k, i]
            if not np.isfinite(v):
                line += " "
            else:
                t = (v - lo) / max(1e-9, hi - lo)
                line += ramp[int(np.clip(t, 0, 1) * (len(ramp) - 1))]
        out.append(line)
    return out


def report(path):
    ds = xr.open_dataset(path, decode_timedelta=True)
    da = ds["thetao"].isel(time=0)
    T = da.values.astype("float64")
    depth = ds["depth"].values.astype("float64")
    lat = ds["latitude"].values
    lon = ds["longitude"].values

    print("=" * 72)
    print(path.rsplit("/", 1)[-1])
    print(f"  grid      {T.shape[2]} lon x {T.shape[1]} lat x {T.shape[0]} levels"
          f"   {lon[0]:.2f}-{lon[-1]:.2f}E  {lat[0]:.2f}-{lat[-1]:.2f}N")
    print(f"  depth     {depth[0]:.2f} -> {depth[-1]:.2f} m")
    sst = T[0]
    print(f"  SST       {np.nanmin(sst):.2f} - {np.nanmax(sst):.2f} degC"
          f"   (median {np.nanmedian(sst):.2f})")
    print(f"  water     {np.isfinite(sst).mean() * 100:.1f}% of the footprint")

    d26, tchp, cens = field(T, depth)
    q26, qtchp, _qcens = field(quantise(T), depth)

    water = np.isfinite(sst)
    warm = np.isfinite(d26)
    print()
    print(f"  columns warmer than 26 degC at the surface: "
          f"{warm.sum()}/{water.sum()} ({warm.sum() / max(1, water.sum()) * 100:.1f}%)")
    print(f"  D26   p5 {pct(d26, 5):6.1f}   median {pct(d26, 50):6.1f}   "
          f"p95 {pct(d26, 95):6.1f}   max {np.nanmax(d26):6.1f} m")
    print(f"  TCHP  p5 {pct(tchp, 5):6.1f}   median {pct(tchp, 50):6.1f}   "
          f"p95 {pct(tchp, 95):6.1f}   max {np.nanmax(tchp):6.1f} kJ/cm2")
    over = np.isfinite(tchp) & (tchp >= THRESHOLD)
    print(f"  over 40 kJ/cm2: {over.sum()}/{np.isfinite(tchp).sum()} water columns"
          f"  ({over.sum() / max(1, np.isfinite(tchp).sum()) * 100:.1f}%)")
    print(f"  censored (warm layer runs past the deepest valid level): "
          f"{cens.sum()} columns")

    # The RG8 path is EXACTLY what the browser computes from. Printed on its own
    # so the JS can be compared against it for equality, not for closeness — the
    # two are running the same algorithm on the same bytes and should agree to
    # float rounding, and any real gap is a bug in one of them.
    qover = np.isfinite(qtchp) & (qtchp >= THRESHOLD)
    print()
    print("  RG8 path (what the browser sees) -- compare the JS to THESE")
    print(f"    water {int(np.isfinite(qtchp).sum())}  warm {int(np.isfinite(q26).sum())}"
          f"  over40 {int(qover.sum())}  censored {int(_qcens.sum())}")
    print(f"    d26  min {np.nanmin(q26):.4f}  max {np.nanmax(q26):.4f}")
    print(f"    tchp min {np.nanmin(qtchp):.4f}  max {np.nanmax(qtchp):.4f}")

    dq = np.abs(qtchp - tchp)
    dd = np.abs(q26 - d26)
    print()
    print("  8-bit quantisation cost (RG8 vs float64 NetCDF)")
    print(f"    TCHP  mean {np.nanmean(dq):.3f}   p95 {pct(dq, 95):.3f}   "
          f"max {np.nanmax(dq):.3f} kJ/cm2")
    print(f"    D26   mean {np.nanmean(dd):.3f}   p95 {pct(dd, 95):.3f}   "
          f"max {np.nanmax(dd):.3f} m")
    flip = np.isfinite(tchp) & (((tchp >= THRESHOLD) != (qtchp >= THRESHOLD)))
    print(f"    columns that change side of the 40 kJ/cm2 line: {flip.sum()}")

    lo, hi = pct(tchp, 2), pct(tchp, 98)
    print()
    print(f"  TCHP, north up, ramp {lo:.0f} -> {hi:.0f} kJ/cm2   "
          f"('#' and above is over the threshold)" if hi > THRESHOLD else "")
    for line in ascii_map(tchp, lo, hi):
        print("    |" + line + "|")
    print()
    print(f"  D26 depth, north up, ramp {pct(d26, 2):.0f} -> {pct(d26, 98):.0f} m")
    for line in ascii_map(d26, pct(d26, 2), pct(d26, 98)):
        print("    |" + line + "|")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        report(p)
