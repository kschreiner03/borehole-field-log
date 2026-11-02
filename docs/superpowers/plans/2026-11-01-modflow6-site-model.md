# MODFLOW 6 site model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build, calibrate and run a 3D MODFLOW 6 flow-and-transport model from the project, and draw its results on the cross-section and map.

**Architecture:**
- **Electron main:** runs the bundled `mf6` in a fresh temporary folder (`src/main/mf6run.mjs`, shared with the tests), with IPC `mf6:run`, exposed as `window.desktop.mf6Run`.
- **`index.html`:** everything else, as pure functions:
  - `mf6Files(spec)` writes the input files;
  - `mf6ReadHeads` and `mf6ReadBudget` read the binary outputs;
  - `gwModelSpec(list, site)` builds the site model;
  - `gwCalibrate` runs Levenberg–Marquardt with prior information;
  - `gwTransport` runs GWT;
  - `gwPaths` computes pathlines;
  - a Model page shows the panel, and drawSection and drawSite get model layers.

**Spec:** `docs/superpowers/specs/2026-11-01-modflow6-site-model-design.md`

## Global Constraints
- **Units:** metres and days. Slug-test K is converted from m/s × 86400.
- **The bridge accepts** `{ files: {name: text}, outputs: string[] }`. Names must match `^[\w.-]+$`. The run times out at 120 s.
- **Labels:** model output reads "Model (MODFLOW 6), not measured" with the calibration round, in the purple family.
- **Sources:**
  - every parameter carries a source: slug test, calibrated, entered, CCME (2008) or assumed;
  - K is never filled from a textbook.

## Review Focus
1. A project with one correlated unit, or a unit present in only one borehole: the layer thins to pass-through cells elsewhere, and MODFLOW still converges.
2. Fewer than 3 wells with heads: the model refuses, naming the reason (needs a flow direction).
3. Calibration where K and recharge are perfectly correlated (no K data): finishes, reports the correlation and warns.
4. The web version (no desktop bridge): the panel says the model needs the desktop app; the section falls back to Domenico.
5. A model run that fails (bad input, non-convergence): the error from MODFLOW's listing is shown and nothing is drawn.

---
### Task 1: Bundled MODFLOW 6 and the bridge
- [ ] Test "mf6: bridge runs a model": `desktop.mf6Run` with a 1-cell-row model returns `ok`, a listing containing "Normal termination", and the requested `gwf.hds` bytes. A file name with `/` is refused.
- [ ] Implement `runMf6`, the IPC handler, the preload, and the test harness preload. Commit.

### Task 2: Writer, readers and the analytical check
- [ ] Test "mf6: flow against the analytical solution": a confined strip between fixed heads 16 and 14 m with recharge R gives h(x) = h1 + (h2 − h1)x/L + R x(L − x)/(2T) within 1 mm. `mf6ReadHeads` matches the OBS CSV to 1e-9. The budget discrepancy is below 1 %.
- [ ] Implement `mf6Files`, `mf6ReadHeads`, `mf6ReadBudget` and `mf6Discrepancy`. Commit.

### Task 3: Site model from the project
- [ ] Test "mf6: site model from the example": the layers equal the correlated units; pinched cells are IDOMAIN −1; the CHD faces are on the first and last columns; there is one head observation per well with a reading in the round; K sources come from slug tests or calibration. It runs and converges.
- [ ] Implement `gwModelSpec`. Commit.

### Task 4: Calibration
- [ ] Test "mf6: calibration recovers known parameters": generate heads with K and R known, start them off by ×3, and recover both within 5 %. The stats include RMSE, the scaled RMS, the discrepancy, the sensitivities and the correlation. With no prior and two parameters, the K–R correlation warning is shown.
- [ ] Implement `gwCalibrate`. Commit.

### Task 5: Transient flow across rounds
- [ ] Test "mf6: transient rounds": one stress period per round. Heads at a well rise in the spring round. The residual table covers every round.
- [ ] Implement it. Commit.

### Task 6: Transport
- [ ] Test "mf6: transport against Ogata–Banks": a 1-D column within 3 % at the front, with sorption reducing the velocity by R. Site transport outputs a concentration at each round, compared with the measured results.
- [ ] Implement `gwTransport`. Commit.

### Task 7: Pathlines
- [ ] Test "mf6: pathlines follow flow": from the source, the path moves downgradient, and the travel time to the downgradient boundary equals ∫ds/v within 5 % for the uniform strip.
- [ ] Implement it. Commit.

### Task 8: Model page
- [ ] Test "mf6: model page": the rail has a Model page. It covers inputs with sources, Run / Calibrate / Transport buttons, the features editor, the results tables and the export zip. The web version (no bridge) shows the desktop-only message.
- [ ] Implement it. Commit.

### Task 9: Cross-section and map
- [ ] Test "mf6: drawn on the section": after a run, the section shows the model water table, head contours with labels, flow arrows and the MODFLOW 6 plume. The guided shape uses `mf6`. The labels name MODFLOW 6 and the calibration round. Without a run, it falls back to Domenico.
- [ ] Implement it, plus head contours and pathlines on the map. Then the full suite, the review, and the merge.
