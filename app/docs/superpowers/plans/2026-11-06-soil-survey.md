# Soil Survey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Soil Survey page where soil points and their depth samples are entered or imported, explored on maps and graphs, and exported to reports.

**Architecture:** Maths in a page-free script, `app/lib/soilstats.js`, exposed as `globalThis.SoilStats` and unit tested. The UI lives in `app/index.html` beside the existing pages. Data sits in the per-project site record, so it saves, undoes and autosaves with the project.

**Tech Stack:** Plain JavaScript in the single-file classic app, SVG, Vitest, the Electron app test harness (`tests/app/run.mjs`).

**Spec:** `app/docs/superpowers/specs/2026-11-06-soil-survey-design.md`

## Global Constraints

- Soil data never touches boreholes, logs, sections, 3D or the groundwater model.
- `app/lib/soilstats.js` has no dependencies and no page access. Network use: none.
- Method thresholds: under 5 points no surface; 5–29 inverse distance (numbers), nearest point (classes); 30 or more ordinary kriging (numbers), indicator kriging (classes).
- Default cell size: a quarter of the median nearest-neighbour spacing. Default fade: beyond 1.5 × that spacing, stopping outside the survey area. Warn when the cell is under a tenth of the spacing.
- Accuracy warning when RMSE exceeds a quarter of the data range. Non-detects default to half the detection limit.
- Every surface label reads "Interpolated, not measured" with method, n, depth and date. Targeted surveys add: "Points were targeted, so this may not represent the whole site."
- Warnings never block. Only impossible settings are refused.
- Depth groups are exact from and to values. Depths are never combined unless asked.
- Limit sets stay labelled "unverified" until each value is checked against its named source.
- Colour-blind safe ramps; symbols and labels accompany colour; black and white print works.
- Depths are stored in metres, like boreholes. Code matches the file's style (dense, few comments, plain wording).

## Review Focus

1. Lab values like `<0.5`, blanks or `ND`: treated as non-detects, never as 0 or as missing without saying so.
2. Two samples at the same coordinates, or a point with no coordinates: no crash or singular matrix; duplicates are averaged for fitting and reported; a point with no coordinates is listed but unmapped.
3. Every value identical, or only one class present: a flat surface and a plain note, with no division by zero in statistics or ramps.
4. Issued project or read-only mode: everything can be viewed, nothing can be edited.
5. Imperial display units: depths and distances display in feet, while stored values and depth groups stay in metres.

---

### Task 1: SoilStats basics

**Files:**
- Create: `app/lib/soilstats.js`, `app/lib/soilstats.d.ts`
- Modify: `app/index.html` (script tag before the main script, after the library tags)
- Test: `tests/soilstats.test.ts`

**Interfaces:**
- Produces, all on `SoilStats`, `Pt = { x, y, v, w? }`:
  - `spacing(pts): { median, min, max, n }` nearest-neighbour distances
  - `merge(pts): { pts, merged }` averages exact duplicates
  - `decluster(pts, cell?): number[]` weights with mean 1
  - `idw(pts, x, y, { power = 2, k = 12 }): number`
  - `nearest(pts, x, y): Pt`
  - `logT(values): { fwd, inv, skew, on }`, on when skew > 1 and all values > 0
  - `alr(sand, silt, clay): [a, b]` and `alrInv(a, b): [sand, silt, clay]`
  - `loo(pts, predict): { rows: [{ i, actual, pred, err }], rmse, bias, range, pctCorrect? }`
  - `grid(pts, { cell, pad }): { x0, y0, nx, ny, cell }`
  - `mask(pts, spacing, x, y): number` opacity 0–1, 1 within 1.5 × spacing of a point fading to 0 at 2 × spacing, 0 outside the convex hull expanded by 1.5 × spacing

- [ ] **Step 1: Write failing tests:** duplicates merge; decluster weights average 1 and a tight cluster gets lower weights; `idw` returns the value exactly at a data point and stays within the data range; `alrInv(alr(...))` round-trips and sums to 100 (including a zero fraction, floored at 0.1); `loo` with a constant predictor gives known RMSE; `spacing` on a 100 m grid gives 100; identical values give `range: 0` and no NaN; one point and zero points return empty results.
- [ ] **Step 2: Run** `npx vitest run tests/soilstats.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement.** The file ends with `globalThis.SoilStats = {...}`; tests `import '../app/lib/soilstats.js'`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Confirm `npm run sync-legacy` copies the file to `resources/legacy/lib/`.
- [ ] **Step 5: Commit** `git commit -m "Soil survey: interpolation basics in a separate tested file"`.

### Task 2: Kriging and class surfaces

**Files:**
- Modify: `app/lib/soilstats.js`, `app/lib/soilstats.d.ts`
- Test: `tests/soilstats.test.ts`, and `tests/fixtures/kriging-reference.json`

**Interfaces:**
- Consumes: Task 1 `Pt`, `merge`, `decluster`.
- Produces:
  - `empirical(pts, { lags?, weights? }): [{ h, g, n }]`
  - `fitVariogram(emp, { model? }): { model: 'spherical'|'exponential', nugget, sill, range, sse, ok } `
  - `krige(pts, vg, x, y, { k = 16 }): { v, var }` ordinary kriging, Gaussian elimination with partial pivoting; a singular system returns the inverse distance value with `var: null`
  - `classField(pts, x, y, { method: 'nearest'|'indicator', vgs? }): { cls, p }`
  - `surface(pts, opts): { g, val: Float32Array, unc: Float32Array, mask: Float32Array }`

- [ ] **Step 1: Write the reference fixture.** Use gstat in R if `Rscript` has it, else PyKrige, else an independent NumPy solve of the kriging equations. Record which in the fixture's `source` field, and say which in the commit message. Fixture: 12 points, one variogram, 5 prediction spots.
- [ ] **Step 2: Write failing tests:** exact at data points with zero nugget; weights sum to 1 (expose through a `krigeWeights` test helper); fixture values match to 1e-4; a synthetic field with known range recovers it within 30% from 400 points; a tiny variogram with all-equal values gives `ok: false` and a flat surface; indicator `p` values sum to 1; a singular system does not throw.
- [ ] **Step 3: Run** vitest. Expected: FAIL.
- [ ] **Step 4: Implement.** Fit spherical and exponential by weighted least squares (weights n/h²) and keep the lower error. Evaluate at most 2,000 points with a nearest-`k` search.
- [ ] **Step 5: Run** vitest. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Soil survey: kriging, variogram fitting and class surfaces"`.

### Task 3: Method choice and warnings

**Files:**
- Modify: `app/lib/soilstats.js`, `app/lib/soilstats.d.ts`
- Test: `tests/soilstats.test.ts`

**Interfaces:**
- Produces:
  - `chooseMethod(n, kind: 'num'|'class'): { method: 'none'|'idw'|'krige'|'nearest'|'indicator', why }`
  - `warningsFor(ctx): [{ id, text, figure: boolean }]`, ctx `{ n, kind, method, vgOk, cell, spacing, maskOff, pointsHidden, depthsCombined, strategy, rmse, range, nonDetects, mixedUnits, forced }`
  - `surfaceLabel(ctx): string[]`

- [ ] **Step 1: Write failing tests** for thresholds 4/5/29/30 for both kinds; one test per warning in the spec's list, each asserting its `id`; exact label text from Global Constraints including the targeted line; an unstated strategy reads "not stated" and warns.
- [ ] **Step 2: Run** vitest. Expected: FAIL.
- [ ] **Step 3: Implement** with plain-language text in the app's style.
- [ ] **Step 4: Run** vitest. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Soil survey: method defaults and warnings"`.

### Task 4: Soil points, samples and the page

**Files:**
- Modify: `app/index.html`, `tests/app/run.mjs`

**Interfaces:**
- Produces:
  - `soilOf(): { survey, points }`, `setSoil(next)` through `setSite`
  - Point `{ id, name, e, n, z, method, notes, order, gg, sub, samples: [] }`
  - Sample `{ id, name, from, to, method, hz, texture, colour, notes, lab, gsd }`
  - `soilDepths(): [{ key, from, to, label, n }]`
  - `soilValue(sample, prop): { v, nd, dl } | null`, where `nd` marks a non-detect
  - `soilProps(): [{ k, label, kind, unit }]`
  - `soilHTML()`, `drawSoil()`, page key `soil`

- [ ] **Step 1: Write the failing app check** `soil survey: points and samples, imports, saved with the project`: add a point and two samples (0–0.15, 0.15–0.30); depth groups list both; a project save and reopen keeps them; borehole count unchanged; survey CSV through the point import sets coordinates; a lab file row matched by sample name fills `lab`, and `<0.5` becomes a non-detect; an issued project shows read-only inputs; imperial units display feet while the stored `from` stays 0.15.
- [ ] **Step 2: Run** `ONLY='soil survey: points' npm run test:app`. Expected: FAIL.
- [ ] **Step 3: Implement:** add `soil` to `RAIL_PAGES` and `PROJECT_TABS`, a `renderView` branch, grids through `WS_SHEETS` with paste, the one-point form with CSSC pickers (`CSSC`, `CSSC_SUB`), point import through `rowsToPoints`, lab import through `parseLabTable` with a soil mapping dialog, and locking through `editable`-style checks on the project.
- [ ] **Step 4: Run** the check. Expected: PASS. Screenshot the page and fix what looks wrong.
- [ ] **Step 5: Commit** `git commit -m "Soil survey: points, depth samples, imports and the page"`.

### Task 5: Map views

**Files:**
- Modify: `app/index.html`, `tests/app/run.mjs`

**Interfaces:**
- Consumes: `soilOf`, `soilValue`, `soilProps`, all `SoilStats` functions, `basemapSVG`.
- Produces:
  - `S.soilView = { prop, depth, view, opts }`
  - `soilMapSVG(W, H, { view, prop, depth, opts }, interactive): string`
  - `soilSurface(prop, depth, opts): { field, method, loo, warnings, label }`, cached by a key of its inputs

- [ ] **Step 1: Write the failing check** `soil survey: maps follow the data`: with 4 points, the heat map option is available but warns, with no surface by default; with 25 points, default inverse distance and its reason is shown; with 40, kriging; label text present; points drawn over the surface; targeted line appears; the RMSE and bias show; class zones show for `order`; pie symbols for sand, silt and clay; all-equal values draw flat with a note; a point with no coordinates is listed as unmapped; black and white print shows labels.
- [ ] **Step 2: Run** the check. Expected: FAIL.
- [ ] **Step 3: Implement:** views from the spec's table, reusing the Map page's pan and zoom (`S.mv`, `previewView`), contour lines from the app's marching code at `drawField`'s neighbour, surfaces as a PNG data URL image so PDF export is clean, and computing in chunks with a "Calculating…" note above 500 points. Add `CTL.soil` groups: Show, Method, Style, Warnings.
- [ ] **Step 4: Run** the check. Expected: PASS. Screenshot each view.
- [ ] **Step 5: Commit** `git commit -m "Soil survey: symbol, heat, class zone and uncertainty maps with accuracy checks"`.

### Task 6: Graphs

**Files:**
- Modify: `app/index.html`, `tests/app/run.mjs`

**Interfaces:**
- Produces: `textureTriSVG(W, pts?)` and `gsdSVG(W, H, curves?)` keep their old behaviour with no second argument; `soilGraphSVG(kind, W, H, view): string` for kinds `texture`, `psd`, `psdBars`, `ecSar`, `ranked`, `depthPairs`, `hist`, `classShare`, `predicted`.

- [ ] **Step 1: Load the `dataviz` skill** and apply its rules.
- [ ] **Step 2: Write the failing check** `soil survey: graphs`: each kind renders from the example survey; the triangle joins a point's two depths; salinity bands name their limit set and show "unverified"; existing `textureTriSVG()` output for the lab page is unchanged; an empty dataset gives a plain message, never a broken chart.
- [ ] **Step 3: Run** the check. Expected: FAIL.
- [ ] **Step 4: Implement,** plus limit sets `S.co.soilLimits` seeded with the Alberta ratings as `verified: false`.
- [ ] **Step 5: Run** the check. Expected: PASS. Screenshot all kinds, light and dark.
- [ ] **Step 6: Commit** `git commit -m "Soil survey: texture, particle size, salinity and comparison graphs"`.

### Task 7: Point card and linked selection

**Files:**
- Modify: `app/index.html`, `tests/app/run.mjs`

**Interfaces:**
- Produces: `soilCardHTML(pointId)`, `S.soilSel`, `soilSelect(id)`.

- [ ] **Step 1: Write the failing check** `soil survey: a point shows everything`: clicking a map point opens classification, each depth sample, lab values against limits and grain size; clicking a graph mark selects the same point on the map and the reverse.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** in the existing drawer.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Soil survey: point card and linked selection"`.

### Task 8: Output and example

**Files:**
- Modify: `app/index.html`, `tests/app/run.mjs`, `README.md`, `app/PRODUCT.md`

**Interfaces:**
- Consumes: `soilMapSVG`, `soilGraphSVG`.
- Produces: report item types `soilmap`, `soilgraph`, `soiltable`; `loadSoilExample()`.

- [ ] **Step 1: Write the failing check** `soil survey: reports and exports`: report items render inside a page, wait on `basemapIdle`, and carry the method note and any figure warnings; Excel export has Points, Samples and Lab sheets; the grid CSV header is `easting,northing,value,uncertainty`; a fictional example survey loads and is clearly labelled.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement,** with title, north arrow, scale bar and legend through the existing item types.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Full verification:** `npm run typecheck`, `npm test`, then `npm run test:app` alone with nothing else running.
- [ ] **Step 6: Commit** `git commit -m "Soil survey: report items, exports, example and docs"`.
