"""
Second tile — DELIBERATELY coastal.

The brief's box (10-15N, 85-90E) turned out to be entirely deep open ocean:
bathy 2700-3500 m, 0% NaN in thetao, seafloor nowhere near the 0-500 m volume.
So it does NOT exercise the two things the spike is meant to de-risk: land/NaN
bleed at coastlines, and the temperature field terminating at a shallow seafloor.

This box spans Sri Lanka + its shelf + open Bay of Bengal to the east, so it has
land cells, a shelf break, and water shallower than 500 m.
"""
import os
import pathlib
import copernicusmarine


def load_env(path=".env"):
    p = pathlib.Path(path)
    for line in p.read_text().splitlines() if p.exists() else []:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


load_env()
USER, PWD = os.environ["CMEMS_USERNAME"], os.environ["CMEMS_PASSWORD"]

BOX = dict(
    minimum_longitude=79.5,
    maximum_longitude=84.5,
    minimum_latitude=6.0,
    maximum_latitude=11.0,
)

copernicusmarine.subset(
    dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
    variables=["thetao"],
    start_datetime="2020-01-01T00:00:00",
    end_datetime="2020-01-01T00:00:00",
    minimum_depth=0,
    maximum_depth=500,
    output_directory="data",
    output_filename="glorys_thetao_coastal.nc",
    overwrite=True,
    username=USER,
    password=PWD,
    **BOX,
)

copernicusmarine.subset(
    dataset_id="cmems_mod_glo_phy_my_0.083deg_static",
    dataset_part="bathy",
    variables=["deptho", "mask", "deptho_lev"],
    output_directory="data",
    output_filename="glorys_bathy_coastal.nc",
    overwrite=True,
    username=USER,
    password=PWD,
    **BOX,
)
print("done -> data/*_coastal.nc")
