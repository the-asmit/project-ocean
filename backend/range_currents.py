"""Step 1 (range) — the remaining animation dates, one call, both components."""
import os, pathlib, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from adapters import glorys

ROOT = pathlib.Path(__file__).parent
RAW = ROOT / "cache" / "raw"
for p in (ROOT / ".env", ROOT.parent / ".env"):
    if p.exists():
        for line in p.read_text().splitlines():
            if line.strip() and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

BBOX = {"lon_min": 79.5, "lon_max": 85.5, "lat_min": 12.0, "lat_max": 18.0}
D0, D1 = "2020-01-02", "2020-01-08"
OUT = RAW / f"cur_bengal_{D0}_{D1}.nc"
if OUT.exists():
    print("already cached:", OUT.stat().st_size); sys.exit(0)

import copernicusmarine
t0 = time.time()
copernicusmarine.subset(
    dataset_id=glorys.DATASET_ID, variables=["uo", "vo"],
    start_datetime=f"{D0}T00:00:00", end_datetime=f"{D1}T00:00:00",
    minimum_depth=0, maximum_depth=500.0,
    minimum_longitude=BBOX["lon_min"], maximum_longitude=BBOX["lon_max"],
    minimum_latitude=BBOX["lat_min"], maximum_latitude=BBOX["lat_max"],
    output_directory=str(RAW), output_filename=OUT.name, overwrite=True,
    username=os.environ["CMEMS_USERNAME"], password=os.environ["CMEMS_PASSWORD"],
)
print(f"OK {time.time()-t0:.1f}s  {OUT.stat().st_size/1e6:.2f} MB")
