# Cross-section: realistic plumes

Date: 2026-11-01. Status: options chosen by the user from the "Plume Section Looks" mock-up; awaiting approval of this doc.

## Intent

The user finds the Section page's plumes "bad and unrealistic". The current drawing:

- treats each groundwater result as a vertical bar across the well screen and joins the bars with straight-sided triangles, so the plume looks like blocky trapezoids ending in vertical walls;
- draws the forecast as a flat-bottomed slab (vertical dispersivity 0, source depth fixed, top on the latest round's water table);
- stacks hatching, a translucent fill, coloured screen bars and the purple forecast, which blend into mud.

The user wants the plume to look realistic while staying defensible: nothing drawn that the data or the labelled model does not support.

## Decided (user)

- **Plume shape: both, switchable.** "Model-guided" by default and "Data only" as the alternative, per section.
  - *Model-guided* (groundwater only): the forecast's concentration field gives the shape. At each well it is multiplied by the factor that makes it equal the measured result at the screen midpoint. That factor (log10) is blended linearly between wells along the section. Labelled "Interpreted: forecast shape matched to measured results". When the forecast cannot run, it falls back to Data only and says why.
  - *Data only*: groundwater results are blended (linear in log10) between wells across the screened depth only. The plume fades to nothing over 0.35 m above and below the screens. Labelled "No data above or below the well screens". Soil and vapour keep their point network, rendered by the new styles.
- **Drawing styles: all three, as a setting.** A = contour lines with a light tint, B = graded shading on a log scale (default), C = filled bands at 1×, 10× and 100× the guideline.
- Everything in the mock-up's "Plan" list, as below.

## Goals

1. Plume shape setting (Model-guided / Data only) and style setting (Lines / Graded / Bands), stored in `S.xs` and carried by report section items.
2. One rendering path. Every plume becomes a concentration grid over the drawing, then is drawn by the chosen style:
   - contour lines from marching squares, joined into continuous lines (so dashes work) and labelled with their values;
   - the plume fades out over 5 m past the outermost data well ("no data beyond") instead of ending in a wall;
   - it is drawn only below the water table on the date shown (groundwater) and inside the ground.
3. Layers: Measured, Forecast or Compare. In Compare, the measured plume uses the chosen style and the forecast is purple dashed contour lines only. Forecast alone uses the same style in the purple family.
4. Forecast realism:
   - the forecast's water table and flow are taken from the round on or before the date shown, not the latest round;
   - vertical dispersivity gets a choice: 0 (BIOSCREEN default, conservative, current) or a published ratio to αx. The ratio is offered only if its source is checked during the build; otherwise it stays as an entered value.
5. Soil steps back while a plume is shown: soil colours turn grey (a "Keep soil colours" switch turns this off), and soil below the water table gets a faint tint.
6. Result markers sit on the borehole column at the screen midpoint, with their value, hollow for non-detects. Water-level labels no longer overlap.

## Non-goals

- Kriging or any interpolation needing a variogram.
- Modelling layers in the forecast (it stays one uniform aquifer).
- Changes to the forecast equation or its checks panel.

## Anti-goals

- A model-guided plume that does not equal the measured value at a well screen.
- Any shape drawn beyond the data without a fade and a label.
- Forecast and measured layers blending into one colour.

## Approaches

- Mock-up options shown to the user: shape Data only / Model-guided; styles A, B and C. The user picked "both, switchable" and "all three".
- The grid renderer is chosen over smoothing the existing triangle network. A grid gives graded shading, fades and model-guided fields one code path. Grid cell size is the builder's call, subject to the existing rule: halving it moves contours by less than 1 % of the section length.

## Constraints

DESIGN.md (the drawing is light and in Arial; selection colour is slate-teal only), PRODUCT.md (anything interpreted or modelled is labelled; nothing invented), single-file `index.html`, tests in `borehole-desktop/tests/app/run.mjs`.

## Left to the builder

The exact panel controls layout, the colour ramps (colour-blind-safe sequential reds for measured, purples for the model), the label placement rules, and the grid cell size.
