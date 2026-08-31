"""Step 2 — magnitude gate. Reads the RAW NetCDF at full precision, so the
numbers are the data's, not an encoding's."""
import pathlib, numpy as np, xarray as xr

nc = pathlib.Path(__file__).parent / "cache" / "raw" / "cur_bengal_2020-01-01.nc"
ds = xr.open_dataset(nc, decode_timedelta=True)
print("dims:", dict(ds.sizes))
print("vars:", list(ds.data_vars))
u = ds["uo"].isel(time=0); v = ds["vo"].isel(time=0)
depth = ds["depth"].values
lat = ds["latitude"].values
print(f"levels {len(depth)}  {depth[0]:.2f} -> {depth[-1]:.1f} m")
print(f"grid lon {ds.sizes['longitude']} x lat {ds.sizes['latitude']}")

spd = np.sqrt(u.values**2 + v.values**2)          # (depth, lat, lon)
valid = np.isfinite(spd)
print(f"\nvalid cells overall: {valid.mean()*100:.1f}%")

# cell size in metres, for the advection comparison
km_per_deg_lat = 111.32
cell_km = km_per_deg_lat / 12.0                    # 1/12 deg grid
print(f"grid cell ~{cell_km:.1f} km\n")

hdr = f"{'depth':>8} {'valid%':>7} {'min':>7} {'mean':>7} {'med':>7} {'p90':>7} {'p99':>7} {'max':>7}   {'km/day@med':>10} {'cells/day':>9}"
print(hdr); print("-"*len(hdr))
targets = [5, 50, 100, 200, 400]
rows = []
for t in targets:
    k = int(np.argmin(np.abs(depth - t)))
    s = spd[k][valid[k]]
    if s.size == 0:
        print(f"{depth[k]:8.1f}  (no valid cells)"); continue
    med = float(np.median(s))
    kmday = med * 86.4                              # m/s -> km/day
    rows.append((depth[k], med, float(s.mean()), float(s.max())))
    print(f"{depth[k]:8.1f} {100*valid[k].mean():6.1f}% {s.min():7.4f} {s.mean():7.4f} "
          f"{med:7.4f} {np.percentile(s,90):7.4f} {np.percentile(s,99):7.4f} {s.max():7.4f}   "
          f"{kmday:10.1f} {kmday/cell_km:9.2f}")

# whole-column summary + what 8-bit over the configured range would cost
allv = spd[valid]
print(f"\nwhole tile: mean {allv.mean():.4f}  median {np.median(allv):.4f}  "
      f"p99 {np.percentile(allv,99):.4f}  max {allv.max():.4f} m/s")
print(f"|u| max {np.nanmax(np.abs(u.values)):.4f}   |v| max {np.nanmax(np.abs(v.values)):.4f} m/s")
rng = 3.0   # the configured uo range is [-1.5, 1.5]
print(f"\n8-bit over the configured +/-1.5 m/s: {rng/255:.5f} m/s per code")
print(f"  -> median speed {np.median(allv):.4f} m/s spans {np.median(allv)/(rng/255):.1f} codes")
tight = float(np.percentile(np.abs(np.concatenate([u.values[valid], v.values[valid]])), 99.9))
print(f"  a tight range of +/-{tight:.2f} m/s (99.9th pct of |u|,|v|) would give "
      f"{2*tight/255:.5f} m/s per code -> {np.median(allv)/(2*tight/255):.1f} codes")

# how much structure is there? fraction of the surface layer above thresholds
k = int(np.argmin(np.abs(depth - 5)))
s0 = spd[k][valid[k]]
for th in (0.1, 0.2, 0.3, 0.5):
    print(f"  surface cells faster than {th} m/s: {100*(s0>th).mean():5.1f}%")
