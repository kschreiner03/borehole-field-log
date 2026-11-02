# A readable plume in the 3D view

Date: 2026-11-02. The user asked how to get a better 3D view of the plume; they chose the recommended items 1, 2 and 4 ("lets fix").

## Intent
The 3D page should show where the contamination is in the ground, as a shape you can read while rotating, with no doubt about what is measured, interpreted or modelled.

## Decided
- **A plume is always shown when there are results:**
  - With a MODFLOW 6 transport run: the model's concentrations, labelled "Model (MODFLOW 6), not measured", purple family.
  - Without one: interpolated from the measured groundwater results, labelled "Interpreted from measured results, not modelled", red family. The rules:
    - in plan, inverse distance (power 2) on log concentration between the wells' latest results up to the date shown; non-detects count at half the detection limit;
    - with depth, the band between the interpolated screen top and screen bottom, fading over 0.35 m;
    - beyond the wells, fading to nothing over 5 m outside their outline.

    These are the same rules as the cross-section's data-only shape.
  - The 3D page runs the model when one is set up (a calibration or transport saved) and none has run this session, as the Reports page does, then redraws.
- **Smooth nested shells** at 1×, 10× and 100× the guideline, from the field sampled on a regular grid. A surface-nets isosurface replaces the cell boxes. The outer shell is faint and the inner ones are stronger. Results spheres stay, so the shells can be checked against the data.
- **Seeing inside:**
  - "Cut along the section line" with a position slider: a vertical clipping plane parallel to section A–A′ (the picked boreholes, else the best-fit line) removes the near side. The cut face shows the plume colours on that plane.
  - While shells are shown, the ground and unit surfaces fade (opacity about 0.12).
- The legend states the plume source, the date and the guideline levels.

## Non-goals
Finer model layers (item 3) and the time slider (item 5) are later items.

## Anti-goals
- A shape with no label saying where it comes from.
- An interpolated shape extending far beyond the wells.
