"""
Raw dataset inspection — P7: report structure, do not guess it.
Prints everything needed before writing any rendering/adapter code.
"""
import numpy as np
import xarray as xr

LINE = "=" * 78


def banner(t):
    print("\n" + LINE + "\n" + t + "\n" + LINE)


def describe_var(da):
    vals = da.values
    finite = vals[np.isfinite(vals)]
    print(f"  dtype               : {vals.dtype}")
    print(f"  shape               : {vals.shape}  dims={da.dims}")
    print(f"  attrs               : {dict(da.attrs)}")
    print(f"  encoding _FillValue : {da.encoding.get('_FillValue')}")
    print(f"  encoding missing_v  : {da.encoding.get('missing_value')}")
    print(f"  total cells         : {vals.size}")
    print(f"  NaN cells           : {np.isnan(vals).sum()}  ({100*np.isnan(vals).mean():.1f}%)")
    if finite.size:
        print(f"  finite min / max    : {finite.min():.5f} / {finite.max():.5f}")
        print(f"  finite mean         : {finite.mean():.5f}")
        pct = np.percentile(finite, [1, 5, 50, 95, 99])
        print(f"  finite pctiles 1/5/50/95/99 : {np.array2string(pct, precision=3)}")


banner("FILE 1 — GLORYS thetao  (data/glorys_thetao_tile.nc)")
ds = xr.open_dataset("data/glorys_thetao_tile.nc", decode_timedelta=True)
print(ds)
print("\n--- coordinates ---")
for name in ds.coords:
    c = ds[name]
    v = c.values
    print(f"\n[{name}]  dims={c.dims} dtype={v.dtype} size={v.size}  attrs={dict(c.attrs)}")
    if v.size <= 60:
        print("  values:", np.array2string(np.asarray(v).ravel(), precision=5, threshold=100))
    else:
        print("  first5:", v[:5], " last5:", v[-5:])
    if np.issubdtype(v.dtype, np.number) and v.size > 1:
        d = np.diff(v.astype("float64"))
        print(f"  step: min={d.min():.6g} max={d.max():.6g} "
              f"{'UNIFORM' if np.allclose(d, d[0], rtol=1e-4) else 'NON-UNIFORM'}  "
              f"ascending={bool(np.all(d > 0))} descending={bool(np.all(d < 0))}")

banner("thetao variable")
describe_var(ds["thetao"])

if "depth" in ds.coords:
    dvals = ds["depth"].values.astype("float64")
    banner("DEPTH LEVELS (full list)")
    for i, z in enumerate(dvals):
        gap = "" if i == 0 else f"(+{z - dvals[i-1]:.3f} m)"
        print(f"  level {i:2d}: {z:10.4f} m   {gap}")
    print(f"\n  {len(dvals)} levels, {dvals[0]:.3f}..{dvals[-1]:.3f} m")

banner("FILE 2 — static bathymetry  (data/glorys_bathy_tile.nc)")
db = xr.open_dataset("data/glorys_bathy_tile.nc", decode_timedelta=True)
print(db)
print("\n--- coordinates ---")
for name in db.coords:
    c = db[name]
    v = c.values
    print(f"\n[{name}] dims={c.dims} dtype={v.dtype} size={v.size} attrs={dict(c.attrs)}")
    if v.size <= 20:
        print("  values:", v)
    else:
        print("  first5:", v[:5], " last5:", v[-5:])
    if np.issubdtype(v.dtype, np.number) and v.size > 1:
        d = np.diff(v.astype("float64"))
        print(f"  ascending={bool(np.all(d > 0))} descending={bool(np.all(d < 0))}")

for vn in db.data_vars:
    banner(f"bathy variable: {vn}")
    describe_var(db[vn])

banner("CROSS-CHECK: grids align between the two files?")
for ax in ("latitude", "longitude"):
    a = ds[ax].values if ax in ds else None
    b = db[ax].values if ax in db else None
    if a is not None and b is not None:
        print(f"  {ax}: thetao size={a.size} bathy size={b.size} "
              f"same={a.size == b.size and np.allclose(a, b)}")

banner("SAMPLE: one vertical column near tile centre (thetao)")
mid = ds["thetao"].isel(
    time=0,
    latitude=ds.sizes["latitude"] // 2,
    longitude=ds.sizes["longitude"] // 2,
)
for z, t in zip(ds["depth"].values, mid.values):
    print(f"  {z:9.3f} m : {t:.4f}" + ("" if np.isfinite(t) else "  <-- NaN"))
