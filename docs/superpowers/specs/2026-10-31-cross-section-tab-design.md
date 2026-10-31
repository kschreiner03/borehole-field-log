# Cross-section tab: layers, water and plume over time

Date: 2026-10-31. Status: draft for approval. Approach chosen in conversation: "Both should get built" (A, measured
data over time, then B, a labelled analytical forecast on top of it).

## Intent

Consultants need to see on one section what the ground is, where the water is, and where the contamination is and is going,
for the contaminant they choose, at any date they have data for, and to be able to defend every line on it. Today the
section lives inside the Map page, mixes measured and interpreted lines without saying so, and has no plume or time.

## Goals

1. **A Cross-section page on the left rail** (between Lab and Reports) holding the section line, the drawing and every
   setting for layers, water and plume. The Map page keeps a link to it; report pages keep drawing the same section.
2. **Honest layers.** Logged columns drawn exactly; correlation between boreholes drawn as interpretation (dashed,
   lighter, labelled "interpreted"). The user can override the automatic name-based correlation by pairing units by
   hand. Boreholes off the line are shown with their offset distance ("BH-3, 6.2 m NE of line, projected").
3. **Honest water.** Per date: the measured level at each well as a solid tick, joined to the next well by a dashed
   "interpolated" line only when both readings are the same kind (static) and from the same monitoring round. Seepage
   and strikes are marked as such and never joined. The ground line is marked "interpolated between boreholes".
4. **Groundwater lab results** as new data per well: sampling date, sample ID, lab, report number, results per
   parameter with non-detect flag, in mg/L, with their own guideline set (site groundwater guideline), importable from the
   same lab CSV formats as soil.
5. **Plume, measured (A).** For one chosen medium (soil, groundwater or headspace vapour) and one chosen parameter, at one
   chosen date:
   - every result plotted at its true position (soil and vapour at sample depth; groundwater across the well's screen
     below the water table), coloured by concentration, non-detects drawn hollow;
   - contours of the guideline and ×10 and ×100 the guideline, interpolated linearly in log10 concentration on a
     triangulated network of the sample points in section coordinates, drawn only inside the hull of the data (no
     extrapolation), hatched and labelled "interpolated";
   - a time slider whose stops are the actual sampling and water-level dates; at a stop, each location shows its latest
     result on or before that date and its age ("sampled 14 months earlier"); a "this round only" switch hides older
     results; play steps through the stops.
6. **Plume, forecast (B)**, a separate layer, always labelled "Model, not measured":
   - Domenico (1987) analytical solution for advection, dispersion in three directions, linear sorption (retardation
     R = 1 + ρb·Kd/n, Kd = Koc·foc) and first-order decay, from a vertical plane source;
   - groundwater velocity from the app's existing flow calculation (gradient, slug-test K, effective porosity);
   - the source at a chosen well or the excavation footprint, with source concentration either measured groundwater at
     the source, or calculated from soil by the soil–water partitioning and mixing-zone dilution equations of ASTM E1739
     (driven by the recharge rate the user enters);
   - evaluated on the section by projecting each point onto the flow direction (distance downgradient and offset across
     it), at any date including future dates;
   - every parameter shown with its value, unit and source, editable, and an edited value marked as the user's.
7. **Recharge** shown two ways: measured (water-table rise and fall between dates, animated with the slider) and, in the
   model, as the recharge rate that drives leaching from a soil source and the dilution in the mixing zone.
8. **Verification built in** (a "Checks" panel and automated tests):
   - units and dimensions: every model input carries a unit; the calculation refuses inconsistent units;
   - an independent exact solution: for the one-dimensional case the model must match the Ogata–Banks (1961) solution,
     computed separately, to within 1 %;
   - published worked examples: the model reproduces a worked example from a published source (BIOSCREEN manual, USEPA
     1996, or ASTM E1739 appendix) to the precision printed there;
   - against the user's data: when a later sampling round exists, the model's prediction for that date is compared with
     the measured results at those wells and the differences are listed;
   - stated limits: the known error of the Domenico solution at high dispersivity (West et al., 2007) and the
     assumptions (uniform soil, steady uniform flow, no NAPL) shown beside the result.
9. The section, with any combination of these layers at any date, can be placed on a report page; its date and every
   "interpreted" or "model" label go with it.

## Non-goals

- Numerical flow or transport models (MODFLOW/MT3D), pumping, layered or varying soil properties in the model.
- NAPL dissolution or free-product modelling; vapour intrusion into buildings.
- Three-dimensional plume views.
- Statistics on trends (Mann–Kendall) — possible later.

## Anti-goals

- A contour, line or colour that looks measured but isn't. Interpretation is dashed or hatched and labelled; model output
  is a different colour family and labelled on screen and in print.
- A chemical property with no source, or a default presented as site data.
- A model result shown when an input it needs is missing (it says what is missing instead).

## Constraints

- Same single-file app (`index.html`), vanilla JS and SVG, offline; tests in `borehole-desktop/tests/app/run.mjs`.
- DESIGN.md: slate-teal for selection only; data colours only on data; the drawing in Arial; light theme.
- PRODUCT.md: nothing estimated unless labelled; issued logs are locked (groundwater results on an issued borehole follow
  the same lock and revision rules as soil results).
- Existing data stays readable; new fields are additive (`b.gwSamples`, `site.gwGuide`, `site.model`).
- Chemical properties come only from published tables, each value with its citation: US EPA Regional Screening Levels
  chemical-specific parameters table for BTEX (Koc, Henry's constant, solubility), CCME (2008) Canada-Wide Standard for
  PHC in soil, scientific rationale, for the F1 and F2 fractions, and Howard et al. (1991) or the CCME rationale for
  first-order decay half-lives. A value the builder cannot check against its source is left blank and the model will not
  run for that parameter until the user enters one.

## Approaches considered

- **A. Measured data over time:** every shape traces to a lab result; cannot forecast. **Built.**
- **B. A plus an analytical forecast (Domenico, ASTM E1739 source):** answers "where will it be"; simplified, labelled.
  **Built on top of A.**
- C. A numerical model: handles layering and pumping but needs calibration skills and grid set-up; outside a field log
  app and easy to misuse. Not built.

## Decided

- Both A and B (user, 2026-10-31). A first, B second, each committed and tested.
- New left-rail page for everything about the section (user: "new tab on the left").
- Plume sources: soil lab at depth, headspace vapour, and groundwater samples; recharge simulated (user).

## Builder's calls (marked as such)

- Interpolation: linear in log10 on a triangulated network, hull-clipped — the same method the app already uses for the
  water-table map, so the two agree and the choice is easy to explain. Kriging was not chosen: it needs a variogram the
  data rarely supports.
- Media are never combined into one plume (different units and meanings); the user switches between them.
- Default dispersivities: αx from Xu and Eckstein (1995), αy = αx/10, αz = αx/100, labelled as defaults.
- Default foc, bulk density and porosity from the CCME (2008) rationale's coarse- and fine-soil defaults, labelled
  "assumed"; effective porosity stays the value the flow calculation already uses.
- Page order on the rail: Overview, Borehole, Map, Tables, Water, Lab, Cross-section, Reports.

## Left to the builder

- Exact panel layout inside the page (section line picker, layer toggles, plume settings, model inputs, checks), following
  DESIGN.md's panel and data-grid patterns.
- Colour ramp for concentration (sequential, colour-blind safe, distinct from the water blue and from model output).
- Grid resolution of the model evaluation (fine enough that halving it changes contour positions by under 1 % of the
  section length; the test checks this).
