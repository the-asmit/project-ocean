"""Inspect the coastal tile — focus on NaN / land / shallow-seafloor structure."""
import numpy as np
import xarray as xr

ds = xr.open_dataset("data/glorys_thetao_coastal.nc", decode_timedelta=True)
db = xr.open_dataset("data/glorys_bathy_coastal.nc", decode_timedelta=True)

print("=== thetao coastal ===")
print(ds)
t = ds["thetao"]
v = t.values
print("\nshape", v.shape, "dims", t.dims)
print("NaN cells:", np.isnan(v).sum(), f"({100*np.isnan(v).mean():.1f}%)")
fin = v[np.isfinite(v)]
print(f"finite range: {fin.min():.3f} .. {fin.max():.3f} C")

# NaN as a function of depth (surface should be mostly wet, deep mostly dry near coast)
print("\nNaN fraction per depth level:")
for k, z in enumerate(ds["depth"].values):
    frac = np.isnan(v[0, k]).mean()
    print(f"  {z:8.2f} m : {frac*100:5.1f}% NaN")

# a surface slice: where are the NaNs (land)?
surf = v[0, 0]
print(f"\nsurface level NaN count: {np.isnan(surf).sum()} / {surf.size}")
print("surface NaN mask (row = lat ascending, col = lon ascending), '#'=NaN/land '.'=water:")
for row in np.isnan(surf)[::-1]:  # print north-at-top
    print("  " + "".join("#" if x else "." for x in row))

print("\n=== bathy coastal ===")
d = db["deptho"]
dv = d.values
print("deptho shape", dv.shape, "dims", d.dims)
print("deptho _FillValue:", d.encoding.get("_FillValue"))
print("NaN:", np.isnan(dv).sum(), " | non-NaN range:", np.nanmin(dv), "..", np.nanmax(dv))
big = dv[dv > 1e30] if np.any(dv > 1e30) else []
print("cells > 1e30 (unmasked fill?):", len(big))
print("\ndeptho map (north at top), '#'=land/NaN, digit=depth: 0=<50m .. 9=>4000m:")
buckets = [50, 100, 200, 500, 1000, 2000, 3000, 4000, 5000]
for row in dv[::-1]:
    s = ""
    for val in row:
        if not np.isfinite(val) or val > 1e30:
            s += "#"
        else:
            s += str(sum(val > b for b in buckets))
    print("  " + s)

m = db["mask"]
print("\nmask dims", m.dims, "shape", m.values.shape, "values:", np.unique(m.values))
print("mask surface-level land count:", (m.values[0] == 0).sum(), "/", m.values[0].size)
