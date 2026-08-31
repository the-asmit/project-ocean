"""Magnitude + advection gate, June window. Same script shape as the January
run so the two are directly comparable."""
import pathlib, numpy as np, xarray as xr

R = pathlib.Path(__file__).parent / "cache" / "raw"
ds = xr.open_dataset(R / "cur_bengal_2026-06-11_2026-06-18.nc", decode_timedelta=True)
U, V = ds["uo"].values, ds["vo"].values          # (t, depth, lat, lon)
depth = ds["depth"].values
T = U.shape[0]
dates = np.datetime_as_string(ds["time"].values, unit="D").tolist()
print(f"frames {T}  {dates[0]} -> {dates[-1]}   levels {U.shape[1]}  "
      f"lat {U.shape[2]}  lon {U.shape[3]}")

spd = np.sqrt(U**2 + V**2)
valid = np.isfinite(spd)
print(f"valid cells overall: {valid.mean()*100:.1f}%")
cell_km = 111.32/12.0

hdr = (f"{'depth':>8} {'valid%':>7} {'mean':>7} {'med':>7} {'p90':>7} {'p99':>7} "
       f"{'max':>7}   {'km/day@med':>10} {'cells/day':>9}")
print("\n--- magnitudes, mean over the 8 frames ---")
print(hdr); print("-"*len(hdr))
for t_m in [5, 50, 100, 200, 400]:
    k = int(np.argmin(np.abs(depth - t_m)))
    s = spd[:, k][valid[:, k]]
    med = float(np.median(s)); kmday = med*86.4
    print(f"{depth[k]:8.1f} {100*valid[:,k].mean():6.1f}% {s.mean():7.4f} {med:7.4f} "
          f"{np.percentile(s,90):7.4f} {np.percentile(s,99):7.4f} {s.max():7.4f}   "
          f"{kmday:10.1f} {kmday/cell_km:9.2f}")
a = spd[valid]
print(f"\nwhole tile: mean {a.mean():.4f}  median {np.median(a):.4f}  "
      f"p99 {np.percentile(a,99):.4f}  max {a.max():.4f} m/s")
k0 = int(np.argmin(np.abs(depth-5)))
s0 = spd[:, k0][valid[:, k0]]
for th in (0.1, 0.2, 0.3, 0.5):
    print(f"  surface cells faster than {th} m/s: {100*(s0>th).mean():5.1f}%")

print("\n--- field change, consecutive days (surface) ---")
for t in range(T-1):
    du = U[t+1,k0]-U[t,k0]; dv = V[t+1,k0]-V[t,k0]
    m = np.isfinite(du) & np.isfinite(dv)
    d = np.sqrt(du[m]**2+dv[m]**2); s = np.sqrt(U[t,k0][m]**2+V[t,k0][m]**2)
    print(f"  {dates[t]}->{dates[t+1]}: mean |dV| {d.mean():.4f} m/s  "
          f"p90 {np.percentile(d,90):.4f}  max {d.max():.4f}  = {100*d.mean()/s.mean():5.1f}% of mean speed")

# --- streamlines, same scheme as the renderer -------------------------
LON0,LON1,LAT0,LAT1 = 79.5,85.5,12.0,18.0
KM_LON=(LON1-LON0)*111.32*np.cos(np.radians((LAT0+LAT1)/2)); KM_LAT=(LAT1-LAT0)*111.32
SPAN_X=240*KM_LON/max(KM_LON,KM_LAT); WU_PER_KM=SPAN_X/KM_LON
SEEDS,STEPS,DT=420,34,6000.0
def sl(t,k):
    u,v=U[t,k],V[t,k]
    def f(nx,nz):
        fx=np.clip(nx*(u.shape[1]-1),0,u.shape[1]-1.001); fy=np.clip(nz*(u.shape[0]-1),0,u.shape[0]-1.001)
        i0=fx.astype(int); j0=fy.astype(int); tx=fx-i0; ty=fy-j0
        return [np.nan_to_num(arr[j0,i0]*(1-tx)*(1-ty)+arr[j0,i0+1]*tx*(1-ty)
                +arr[j0+1,i0]*(1-tx)*ty+arr[j0+1,i0+1]*tx*ty) for arr in (u,v)]
    cols=int(np.ceil(np.sqrt(SEEDS))); idx=np.arange(SEEDS)
    nx=(idx%cols)/(cols-1); nz=(idx//cols)/(cols-1)
    rs=np.random.RandomState(7)
    nx=np.clip(nx+(rs.rand(SEEDS)-0.5)*0.055,0,1); nz=np.clip(nz+(rs.rand(SEEDS)-0.5)*0.055,0,1)
    pts=np.zeros((SEEDS,STEPS,2))
    for s in range(STEPS):
        pts[:,s,0]=nx; pts[:,s,1]=nz
        u1,v1=f(nx,nz)
        hx=np.clip(nx+u1*DT*0.5/(KM_LON*1000),0,1); hz=np.clip(nz+v1*DT*0.5/(KM_LAT*1000),0,1)
        u2,v2=f(hx,hz)
        nx=np.clip(nx+u2*DT/(KM_LON*1000),0,1); nz=np.clip(nz+v2*DT/(KM_LAT*1000),0,1)
    return pts
print("\n--- streamline vertex motion (surface) ---")
prev=sl(0,k0); tot=[]
for t in range(1,T):
    cur=sl(t,k0); dwu=np.linalg.norm(cur-prev,axis=2)*KM_LON*WU_PER_KM
    tot.append(dwu.mean())
    print(f"  {dates[t-1]}->{dates[t]}: moved {(dwu>1e-4).mean()*100:5.1f}%   "
          f"mean {dwu.mean():6.3f} wu   max {dwu.max():6.3f} wu")
    prev=cur
print(f"\n  overall mean {np.mean(tot):.3f} wu/day")
p=sl(0,k0); arc=np.linalg.norm(np.diff(p,axis=1),axis=2).sum(1)*KM_LON
print(f"  arc length median {np.median(arc):.0f} km = {100*np.median(arc)/KM_LON:.1f}% of tile")
print("\n  JANUARY, for comparison: median 0.2943 m/s, 2.74 cells/day, "
      "72.9% moved, mean 2.156 wu/day")
