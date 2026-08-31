"""Does the REAL field actually change day to day?

Two levels. (1) the field itself, (2) streamlines through it using the same
RK2 scheme, seeding and step count the spike proved -- so the numbers are
directly comparable to the synthetic run's 90.5% moved / mean 0.536 world units.
"""
import pathlib, numpy as np, xarray as xr

R = pathlib.Path(__file__).parent / "cache" / "raw"
a = xr.open_dataset(R / "cur_bengal_2020-01-01.nc", decode_timedelta=True)
b = xr.open_dataset(R / "cur_bengal_2020-01-02_2020-01-08.nc", decode_timedelta=True)
U = np.concatenate([a["uo"].values, b["uo"].values], 0)   # (t, depth, lat, lon)
V = np.concatenate([a["vo"].values, b["vo"].values], 0)
depth = a["depth"].values
T = U.shape[0]
print(f"frames {T}  levels {U.shape[1]}  lat {U.shape[2]}  lon {U.shape[3]}")

# --- 1. field-level change between consecutive days ----------------------
print("\n--- field change, consecutive days (surface level) ---")
k = 0
for t in range(T - 1):
    du = U[t+1, k] - U[t, k]; dv = V[t+1, k] - V[t, k]
    m = np.isfinite(du) & np.isfinite(dv)
    d = np.sqrt(du[m]**2 + dv[m]**2)
    s = np.sqrt(U[t, k][m]**2 + V[t, k][m]**2)
    print(f"  day {t}->{t+1}: mean |dV| {d.mean():.4f} m/s  p90 {np.percentile(d,90):.4f}  "
          f"max {d.max():.4f}   = {100*d.mean()/s.mean():5.1f}% of mean speed")

# --- 2. streamlines, same scheme as the renderer -------------------------
LON0, LON1, LAT0, LAT1 = 79.5, 85.5, 12.0, 18.0
KM_LON = (LON1-LON0)*111.32*np.cos(np.radians((LAT0+LAT1)/2))
KM_LAT = (LAT1-LAT0)*111.32
SPAN_X = 240*KM_LON/max(KM_LON,KM_LAT)        # world units, from makeMapping
WU_PER_KM = SPAN_X/KM_LON
SEEDS, STEPS, DT = 420, 34, 6000.0            # dt seconds/step

def sampler(t, k):
    u, v = U[t, k], V[t, k]
    def f(nx, nz):
        fx = np.clip(nx*(u.shape[1]-1), 0, u.shape[1]-1.001)
        fy = np.clip(nz*(u.shape[0]-1), 0, u.shape[0]-1.001)
        i0 = fx.astype(int); j0 = fy.astype(int)
        tx = fx-i0; ty = fy-j0
        out = []
        for arr in (u, v):
            c = (arr[j0,i0]*(1-tx)*(1-ty) + arr[j0,i0+1]*tx*(1-ty)
                 + arr[j0+1,i0]*(1-tx)*ty + arr[j0+1,i0+1]*tx*ty)
            out.append(np.nan_to_num(c))
        return out
    return f

def streamlines(t, k):
    f = sampler(t, k)
    cols = int(np.ceil(np.sqrt(SEEDS)))
    idx = np.arange(SEEDS)
    nx = (idx % cols)/(cols-1); nz = (idx//cols)/(cols-1)
    rs = np.random.RandomState(7)
    nx = np.clip(nx + (rs.rand(SEEDS)-0.5)*0.055, 0, 1)
    nz = np.clip(nz + (rs.rand(SEEDS)-0.5)*0.055, 0, 1)
    pts = np.zeros((SEEDS, STEPS, 2))
    for s in range(STEPS):
        pts[:, s, 0] = nx; pts[:, s, 1] = nz
        u1, v1 = f(nx, nz)
        hx = np.clip(nx + u1*DT*0.5/(KM_LON*1000), 0, 1)
        hz = np.clip(nz + v1*DT*0.5/(KM_LAT*1000), 0, 1)
        u2, v2 = f(hx, hz)
        nx = np.clip(nx + u2*DT/(KM_LON*1000), 0, 1)
        nz = np.clip(nz + v2*DT/(KM_LAT*1000), 0, 1)
    return pts

print(f"\n--- streamline vertex motion (surface, {SEEDS} seeds x {STEPS} steps) ---")
print(f"    tile {KM_LON:.0f} x {KM_LAT:.0f} km   spanX {SPAN_X:.1f} world units")
prev = streamlines(0, 0)
tot = []
for t in range(1, T):
    cur = streamlines(t, 0)
    d_norm = np.linalg.norm(cur-prev, axis=2)          # normalised tile units
    d_km = d_norm*KM_LON
    d_wu = d_km*WU_PER_KM
    moved = (d_wu > 1e-4).mean()*100
    tot.append(d_wu.mean())
    print(f"  day {t-1}->{t}: moved {moved:5.1f}%   mean {d_wu.mean():6.3f} wu "
          f"({d_km.mean():5.1f} km)   max {d_wu.max():6.3f} wu ({d_km.max():5.1f} km)")
    prev = cur
print(f"\n  overall mean displacement {np.mean(tot):.3f} world units/day")
print(f"  synthetic spike, for comparison: 90.5% moved, mean 0.536 wu, max 5.161 wu")
# arc length, so the "moves a lot" number has a scale
p = streamlines(0, 0)
arc = np.linalg.norm(np.diff(p, axis=1), axis=2).sum(1)*KM_LON
print(f"  streamline arc length: median {np.median(arc):.0f} km, "
      f"= {100*np.median(arc)/KM_LON:.1f}% of tile width")
