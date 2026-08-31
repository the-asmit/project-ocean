import os, pathlib, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from adapters import glorys

ROOT = pathlib.Path(__file__).parent
RAW = ROOT / "cache" / "raw"
for p in (ROOT / ".env", ROOT.parent / ".env"):
    if p.exists():
        for line in p.read_text().splitlines():
            if line.strip() and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip())

BBOX = {"lon_min": 79.5, "lon_max": 85.5, "lat_min": 12.0, "lat_max": 18.0}
D0, D1 = "2026-06-11", "2026-06-18"
OUT = RAW / f"cur_bengal_{D0}_{D1}.nc"
if OUT.exists():
    print("cached:", OUT.stat().st_size); sys.exit(0)
t0 = time.time()
glorys.fetch_subset_range(BBOX, D0, D1, list(glorys.CURRENT_VARS),
                          OUT, os.environ["CMEMS_USERNAME"], os.environ["CMEMS_PASSWORD"])
print(f"OK {time.time()-t0:.1f}s  {OUT.stat().st_size/1e6:.2f} MB")
