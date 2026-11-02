# Realistic plumes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Section page's blocky plume drawing with one grid renderer that offers a model-guided or data-only shape and three drawing styles, and fix the forecast's slab look.

**Architecture:** All in `index.html`. New pure functions build a concentration grid in screen coordinates: `plumeField` for measured data (two methods) and the existing `modelGrid` for the forecast. A renderer, `fieldSVG`, draws any grid as lines, graded cells or bands, plus chained, labelled contours. `drawSection` calls it for each layer.

**Tech Stack:** vanilla JS and SVG. Electron checks run with `npm run sync-legacy` then `ONLY=<name> node scripts/test-app.mjs`; the whole suite runs with `npm run test:app`.

**Spec:** `docs/superpowers/specs/2026-11-01-realistic-plumes-design.md`

## Global Constraints

- `S.xs` gains `shape: 'guided'|'data'` (default 'guided'), `style: 'lines'|'graded'|'bands'` (default 'graded'), `layer: 'meas'|'model'|'both'`, and `soilColour: boolean` (default false). Report items copy these in `o.xs`.
- Contour levels are guideline × 1, 10 and 100. Interpolation is linear in log10.
- A model-guided field equals the measured value at every screen midpoint within 1 %.
- The data-only groundwater field is zero more than 0.35 m outside the screened depth.
- The fade past the outermost data well is 5 m. Labels: "Interpreted: forecast shape matched to measured results", "No data above or below the well screens", "no data beyond".
- Halving the grid cell moves the ×1 contour's furthest downgradient point by less than 1 % of the section length.
- In Compare, the forecast draws only `path[data-model-contour]` with a dasharray and no fills.

## Review Focus

1. Model-guided where the forecast can't run (no coordinates or elevations, flat gradient, no source): it falls back to Data only and the note names the reason.
2. A well whose forecast value is about 0 but whose measured value is positive: the correction factor is clamped to ±2 in log10, with no Infinity or NaN cells.
3. Non-detects: their detection limit is used as an upper bound. The guided field at that screen is at or below the DL, and the marker is hollow.
4. A single-well section, or wells at the same position: a finite grid, and no division by zero in the along-section blend.
5. Report pages at print size: the style, shape and labels carry over. Graded cells add no more than about 1 MB to the SVG; use a coarser cell for print if needed.

---

### Task 1: Forecast uses the dated water table; vertical dispersivity choice
**Produces:** `gwFlow(list, date?)` uses the round on or before `date` when given; `modelRun` passes `S.xs.date`. `MODEL_FIELDS.az` offers 0 (default, cited BIOSCREEN) or a ratio to αx. The ratio is offered only if its source text is checked during the build; otherwise az stays a typed value.
- [ ] Test "plumes: forecast on the dated water table": in the cross-section example at 2024-05-14, `modelRun().P.fit` at MW-1 equals the static level of the round on or before that date (±0.05 m), not the latest round. With `site.model.az` cleared, `P.az === 0` and its source says BIOSCREEN.
- [ ] Run to see it fail, implement, run to see it pass, then commit "Forecast: water table and flow from the date shown".

### Task 2: Measured concentration field
**Produces:** `plumeField(pos, xs, G, cell): {nx, ny, c: Float32Array, a: Float32Array, cell, method, note}`, where `a` is the fade weight from 0 to 1. Groundwater 'data' uses screen-band interpolation. Groundwater 'guided' is the `modelAt` field × 10^r(d), with r interpolated along the section from screen-midpoint residuals, clamped to ±2. Soil and vapour use the existing point network sampled onto the grid. The 5 m edge fade and the water-table clip apply to all.
- [ ] Test "plumes: field honours the data": guided, at every well's screen midpoint, |log10(field) − log10(measured)| < 0.005. Data, a cell 0.5 m below a screen has `a === 0`. Clearing the model's source borehole falls back to 'data' with a note containing the reason. Review Focus items 2 and 4 give finite values only.
- [ ] Run to see it fail, implement, run to see it pass, then commit.

### Task 3: Renderer and styles
**Produces:** `fieldSVG(g, {style, family: 'meas'|'model', dashed})`, which returns the SVG string. Contours are joined into continuous lines (`path[data-contour]` / `[data-model-contour]`) with value labels drawn after the columns. Graded cells use `rect[data-cell]`, merged into horizontal runs of equal colour. Bands use `path[data-band]`.
- [ ] Test "plumes: three styles": in the example, each style draws ≥ 1 ×1 contour. Graded has `rect[data-cell]` and no `[data-band]`. Bands has `[data-band]` and no cells. Lines has a value label "0.005". Grid-halving check: the furthest point moves < 1 % of the length.
- [ ] Run to see it fail, implement (replace the TIN drawing in `plumeSVG` and the fills in `modelSVG`), run to see it pass, then commit.

### Task 4: Layers, Compare, soil steps back, markers
**Produces:** controls in `xsPlumeCtl`: shape (Model-guided / Data only), style (Lines / Graded / Bands), layer (Measured / Forecast / Compare), and "Keep soil colours". While a plume shows, soil fills are greyed unless `soilColour` is on. The saturated zone gets a faint tint. Result markers sit on the column at the screen midpoint.
- [ ] Test "plumes: compare and markers": in Compare, `[data-model-contour]` paths all have a dasharray and no `[data-model-cell]` or band exists. With a plume shown, soil `rect` fills are greys (R = G = B ± 12); with `soilColour` on they are not. Every `[data-pt]` x is within 1 px of its column centre.
- [ ] Run to see it fail, implement, run to see it pass, then commit.

### Task 5: Report items and water labels
**Produces:** section report items keep `shape`, `style` and `layer` in `o.xs`, and print with them. Water-level labels are placed with the same measured-width rows as the borehole names.
- [ ] Test "plumes: report and water labels": a section item with `o.xs.style = 'bands'` renders `[data-band]`. In the example at 700 px wide, no two water-level labels' bounding boxes overlap.
- [ ] Run to see it fail, implement, run to see it pass, then run the full suite and commit. Merge into main once it's green.
