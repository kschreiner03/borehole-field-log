# GIS engines (optional)

Borehole Field Log can use real GIS software for its maps and sections. It is not part of the app and is not shipped with it:
on request (Settings › GIS engines) it is downloaded for the user's own account from conda-forge, as published, and run as
separate programs. The app writes a job file, runs the driver in this folder (`bfl_gis.py`, part of Borehole Field Log) with
the installed Python, and reads the result file back. It does not include, link or change their code.

| Software | Version | Licence | Source |
|---|---|---|---|
| micromamba (the installer) | 2.10.0 | BSD-3-Clause | https://github.com/mamba-org/mamba |
| GRASS GIS | 8.5 | GNU GPL v2 or later | https://github.com/OSGeo/grass |
| GDAL | 3.12 | MIT | https://github.com/OSGeo/gdal |
| PyKrige | 1.7 | BSD-3-Clause | https://github.com/GeoStat-Framework/PyKrige |
| GSTools | 1.7 | LGPL-3.0 | https://github.com/GeoStat-Framework/GSTools |
| Python, NumPy, SciPy and their libraries | as resolved by conda-forge | PSF, BSD-style and others | https://conda-forge.org |

Each package's own licence text is installed with it (in the environment's `info/licenses` folders). The installer download
is pinned to one release and checked against its published SHA-256. Nothing updates on its own; Remove deletes it all.

Methods used, as each tool documents them: GRASS `v.surf.rst`, `v.surf.idw` (and `v.surf.bspline`, `v.vol.rst` where GRASS's
attribute database works; it does not in the Windows build of GRASS 8.5 on conda-forge); GDAL `gdal_grid` (invdist, invdistnn,
linear, nearest), `gdal_contour`, GeoTIFF and GeoPackage drivers; PyKrige `OrdinaryKriging`, `UniversalKriging`,
`OrdinaryKriging3D`; GSTools `vario_estimate`, `fit_variogram`, `krige.Ordinary`.
