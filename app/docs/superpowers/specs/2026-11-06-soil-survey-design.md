# Soil survey: points, maps and graphs

Date: 2026-11-06. Agreed with the user in conversation:
- "soil sampling at points along with full classification ... as a side unrelated to the boreholes";
- "visualize by different soil characteristics classifications like the orders textures see lab results at that point";
- "accurate maps with cool visualizations heat maps or other ways to visualize maybe interpolate the data accurately";
- about 25 targeted samples, "many were close 100m to 75 m apart", 15 cm and 30 cm, hand digging and hand auger, but "it should cater to all amounts and strategies";
- "do what you recommend but make sure there are options that can be changed ... but add warnings";
- "really cool graphs like the texture chart", particle size analysis and salinity;
- approach 1 below ("1").

## Intent

Consultants also run surface soil surveys, separate from boreholes: walk to points, dig or auger shallow samples, classify them and send them to the lab. Today that work has no home in the app. This feature gives it one: enter or import the points, see every result at a point, explore patterns across the site, and produce figures good enough for a client report.

The maps should be striking and honest. A smooth colour map can look far more certain than 25 points allow, so every map says how it was made and how well it held up.

## Goals

- A soil point is its own record, not a borehole, with any number of depth samples.
- Any number of points and any sampling strategy work; what is shown adapts to the data.
- View points by soil order, great group, texture, horizon, method or any lab value, one depth at a time.
- Interpolated maps for measured values, class zones for categories, each with an accuracy check and an uncertainty view.
- Sensible defaults chosen for the data, every one changeable, with a warning when a choice goes beyond what the data supports.
- Graphs: texture triangle, particle size curves, salinity charts, and graphs that compare depths.
- Figures and data go out through the existing reports, PDF and Excel.

## Non-goals

- No link to boreholes, logs, cross-sections, 3D or the groundwater model. Boreholes are not interpolated with soil points.
- No automatic CSSC classification from lab results; the logger classifies. A texture from lab fractions is the exception, as the app does today.
- No terrain or air-photo modelling of soil boundaries (no digital soil mapping with covariates).
- No pass/fail regulatory decision. Limits are shown for reference; the professional decides.

## Anti-goals

It has failed, even if it works technically, if:
- a map hides how few points are behind it, or draws detail finer than the sampling can show;
- an interpolated value can be mistaken for a measurement;
- a warning blocks the user. Warnings inform; only impossible settings are refused;
- targeted sampling is presented as if it were representative of the whole site.

## Approaches

1. **New Soil Survey page in the classic app, with the maths in a separate tested file (chosen).** Reuses the map, basemaps, lab import, texture triangle and reports. Soil data stays apart from boreholes and the numbers can be tested on their own. Cost: more code in an already large `app/index.html`.
2. **Extend the existing Map page.** Least work, but the page gets crowded, the graphs have little room, and soil data sits too close to boreholes.
3. **Build in the React interface.** Cleanest long term, but that interface has no map, basemap, lab import or report tools yet, so all of those would have to be rebuilt first.

## Decided

### Data

- Stored per project in the site record (`S.site.projects[p].soil`, through `setSite`), so it saves in the project file with the features and imagery, and travels with undo and autosave.
- **Survey:** name, date, strategy (grid, random, targeted, mixed; default targeted is not assumed, the field starts empty and an empty strategy is reported in the method note as "not stated"), notes, and the display settings below.
- **Point:** id, name, easting, northing, elevation, method default, site notes (slope, land use, vegetation) and CSSC order, great group and subgroup, reusing the existing `CSSC` and `CSSC_SUB` lists.
- **Sample at a point:** id, from and to depth (free values, so 0–15, 15–30, or a single depth), method (hand dig, hand auger, other, editable list), horizon, texture, colour, field notes, lab results in the existing `lab` shape, and grain size in the existing `gsd` shape.
- **Depth groups:** samples with the same from and to depth form a group, and the map shows one group at a time. Depths are never averaged together unless the user asks, and then with a warning.

### Getting data in

- A grid and a one-point form, in the same pattern as the Samples grid, with paste from Excel.
- Point import reuses `rowsToPoints`, so the survey CSV format works unchanged, including zones.
- Lab import reuses the existing lab file reader, matching by sample name; unmatched samples are shown for mapping by hand.
- Points are placed by clicking the map as well.

### The page

- A new rail page, **Soil survey**, in `PROJECT_TABS`. Map beside a graph area, using the right-hand Settings panel from the settings-panel design for layers, method and style.
- Picking a property and a depth changes the map and graphs together.
- Clicking a point or a graph mark opens a point card: classification, every depth sample, lab values against limits, grain size and photos if any. Selecting on a graph highlights on the map, and the reverse.

### Map views

| View | For | Note |
|---|---|---|
| Symbols | any property | Colour and shape; always available at any point count |
| Graduated circles | numbers | Size by value |
| Pie or bar symbols | sand, silt, clay, or several analytes | Shows composition at each point |
| Heat map | numbers | Interpolated, with optional contour lines |
| Class zones | order, great group, texture | Most likely class in each area |
| Uncertainty | any surface | Where the surface is weakest |
| Value labels | any | Measured value at each point, on by default over a surface |

Measured points are always drawn over a surface unless turned off, which gives a warning.

### Choosing the method

Defaults follow the number of points with a value at the chosen depth (n). The panel states why the default was chosen. All can be overridden.

| n | Default for numbers | Default for classes |
|---|---|---|
| Under 5 | Symbols only, no surface | Symbols only |
| 5–29 | Inverse distance, marked lower confidence | Nearest point (Voronoi) zones |
| 30 or more | Ordinary kriging, fitted variogram | Indicator kriging, most likely class |

Options: method, inverse distance power, search neighbours, variogram model and its values, cell size, log transform, mask distance, colour scale and class breaks.

- **Skewed values:** EC, SAR and chloride default to a log transform when the data are strongly skewed; the setting is shown.
- **Texture surfaces:** sand, silt and clay are interpolated together so they sum to 100 (log-ratio transform), then classed. A plain texture class map remains available.
- **Clusters:** points close together share weight (declustering), on by default, for kriging, summaries and the means shown.

### Accuracy, shown on every surface

- Leave-one-out check: hide each point, predict it, compare. RMSE, mean error (bias) and, for classes, percent correct, shown beside the map and in the figure note.
- A predicted against measured graph, and an optional map of each point's error.
- **Detail limit:** default cell size is a quarter of the median nearest-neighbour spacing. With points 75–100 m apart that is about 20–25 m.
- **Support mask:** colour fades out beyond 1.5 times that spacing from any point and stops outside the survey area, by default.
- **Label:** every surface reads "Interpolated, not measured" with method, n, depth and date. Targeted surveys add: "Points were targeted, so this may not represent the whole site."

### Warnings

Shown beside the control and in a list in the panel. They never block, and a warning that applies to a figure prints in its note unless the user removes it.

- Kriging with fewer than 30 points, or a variogram that could not be fitted.
- Cell size smaller than a tenth of the point spacing.
- Mask or fade turned off, or measured points hidden.
- Depths combined.
- Targeted or unstated strategy.
- Check error large compared with the range of the data (RMSE over a quarter of the range).
- Non-detects replaced by a value. Default: half the detection limit, listed in the note.
- Mixed units or laboratory methods at the same depth.
- Fewer than 5 points when a surface is forced.

### Graphs

- **Texture triangle:** extend `textureTriSVG` to take any list of points; colour by depth, order or a lab value; a line joins a point's 15 and 30 cm samples.
- **Particle size:** extend `gsdSVG`: every curve at a depth, or a median with a band showing the spread, plus stacked sand, silt and clay bars by point.
- **Salinity:** EC against SAR with class bands; EC, SAR, chloride and pH ranked by point; 15 against 30 cm paired lines showing whether salts rise or fall with depth.
- **Any value:** histogram or strip plot; a sorted bar chart; depth comparison; share of each order or texture class.
- Every graph uses the `dataviz` skill's chart rules and works in black and white print.

### Limits

Reference limits are a named, editable set per project. The first set is Alberta's *Soil Quality Criteria Relative to Disturbance and Reclamation* salinity ratings. The builder must check each value against the published source before shipping, name the source on the chart, and leave the set editable. Saskatchewan limits are added the same way when a source is confirmed. Until checked, a set is labelled "unverified".

### Output

- New items in `itemSVG` so the map, graphs and tables can go in reports with `basemapIdle` waited on, on any basemap including Apple.
- Each map figure has title, north arrow, scale bar, legend, source note and method note.
- Excel export of points, samples, lab values and, when asked, leave-one-out results. CSV of a surface's grid for GIS.
- Issued projects lock the survey as they lock boreholes.

### Where the maths lives

- `app/lib/soilstats.js`: plain script, no dependencies, no page access. Holds variogram fitting, kriging, inverse distance, nearest and indicator class surfaces, log-ratio transform, declustering, leave-one-out, spacing and mask.
- Unit tested with Vitest. Tests must include: exactness at data points with no nugget, kriging weights summing to one, a result matched against a reference calculation from an established package (for example gstat in R), recovery of a known variogram from synthetic data, and fractions summing to 100.
- Surfaces are computed off the main thread or in chunks so the page stays responsive at 2,000 points, and results are cached by their inputs.

## Left to the builder

- Layout details, colour ramps (colour-blind safe, sequential for values and diverging only around a limit) and icons.
- Whether a surface is drawn as image or vector, provided it exports cleanly to PDF.
- Build order, starting with data and point views so the feature is useful early.
- Exact wording of warnings, in the app's plain style.

## My calls, for checking

These were not stated by the user:
- Thresholds: under 5 no surface, 30 for kriging, RMSE over a quarter of the range.
- Default cell size and mask distance, tied to spacing.
- Half the detection limit for non-detects.
- Declustering on by default.
- The Alberta salinity ratings as the first limit set.
- Depths kept separate by exact from and to values.
