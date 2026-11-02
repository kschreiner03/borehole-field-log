# 3D view and ParaView export

Date: 2026-11-01. The user chose this ("yes add them") after the options for visual models that show the boreholes and wells were laid out:
- a 3D page inside the app (three.js, MIT licence);
- a ParaView / VTK export for presentation-quality 3D and for reviewers.

## Intent

See the whole site at once in 3D: the logged boreholes and wells, the layers between them, the water table, the plume and the flow paths. Hand the same scene to a reviewer in a standard 3D format.

## Decided

- **A "3D" page on the left rail, after Model.** It uses three.js 0.149.0, the last release with a single-file build. The file is bundled in `lib/` with its SHA-384 integrity, and was checked to be identical on jsDelivr and unpkg.
- **Measured, drawn solid:**
  - borehole columns coloured by soil, at their true positions and elevations;
  - well casings and screens;
  - water levels at the date shown;
  - lab results as coloured spheres at the sample or screen depth (hollow look for non-detects).
- **Interpreted or modelled, see-through and labelled in the legend:**
  - the ground surface and the unit surfaces between boreholes (inverse distance, the same surfaces the model uses), labelled "interpolated";
  - the water table: the MODFLOW 6 heads when the model has run, else the fitted plane of the round, labelled as such;
  - the MODFLOW 6 plume as cells above 1×, 10× and 100× the guideline, and the flow paths. Both are purple-family and labelled "Model (MODFLOW 6), not measured".
- **Controls:**
  - drag to rotate, shift-drag or right-drag to pan, wheel to zoom, reset view;
  - vertical exaggeration ×1 / ×2 / ×5 / ×10 (stated on screen);
  - a switch per layer;
  - save the view as PNG.
- **No WebGL:** the page says so and offers the ParaView export.
- **ParaView export: a zip of VTK XML files in real coordinates (UTM metres, elevation m, no exaggeration):**
  - `boreholes.vtp` (an interval per layer, with unit, USCS and borehole);
  - `wells.vtp` (casing and screen);
  - `samples.vtp` (results);
  - `surfaces.vtp` (ground and unit bases);
  - `model.vtu` (active cells, with layer, K and head);
  - `concentration_<date>.vtu` plus `concentration.pvd`, for time animation in ParaView;
  - `paths.vtp` (travel time per point);
  - a README naming what is measured, interpolated or modelled.

## Non-goals

Editing in 3D, terrain from DEMs, and volume rendering.

## Anti-goals

Any interpolated or modelled shape in 3D without a label in the legend, and exaggeration that isn't stated.
