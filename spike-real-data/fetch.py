"""
Real-data spike: fetch ONE small real tile from Copernicus Marine.
GLORYS reanalysis temperature + matching static bathymetry.
Throwaway. Credentials come from CMEMS_USERNAME / CMEMS_PASSWORD env vars
(which live in the project .env files).
"""
import os
import pathlib
import copernicusmarine


def load_env(path=".env"):
    p = pathlib.Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


load_env()
USER = os.environ["CMEMS_USERNAME"]
PWD = os.environ["CMEMS_PASSWORD"]

# small box: 10-15N, 85-90E (central Bay of Bengal)
BOX = dict(
    minimum_longitude=85.0,
    maximum_longitude=90.0,
    minimum_latitude=10.0,
    maximum_latitude=15.0,
)

print("=== 1/2 GLORYS thetao (temperature) ===")
copernicusmarine.subset(
    dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
    variables=["thetao"],
    start_datetime="2020-01-01T00:00:00",
    end_datetime="2020-01-01T00:00:00",
    minimum_depth=0,
    maximum_depth=500,
    output_directory="data",
    output_filename="glorys_thetao_tile.nc",
    overwrite=True,
    username=USER,
    password=PWD,
    **BOX,
)

print("=== 2/2 static bathymetry (deptho + land mask) ===")
# NOTE: the id in the brief (cmems_mod_glo_phy_my_0.083deg_staticbathy) does not
# exist. The real GLORYS static dataset is `..._static`, part "bathy", with
# deptho (sea_floor_depth_below_geoid, m, positive down), mask (sea_binary_mask)
# and deptho_lev (model level index at seafloor).
copernicusmarine.subset(
    dataset_id="cmems_mod_glo_phy_my_0.083deg_static",
    dataset_part="bathy",
    variables=["deptho", "mask", "deptho_lev"],
    output_directory="data",
    output_filename="glorys_bathy_tile.nc",
    overwrite=True,
    username=USER,
    password=PWD,
    **BOX,
)

print("done -> data/")
