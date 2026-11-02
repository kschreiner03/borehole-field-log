# MODFLOW 6 site groundwater model

Date: 2026-11-01. Approach chosen by the user in conversation:
- "mod flow 6" (option A: run the real USGS MODFLOW 6 inside the desktop app);
- a 3D site model ("yes");
- "implement this and make sure it's fully implemented with calibration and such; it will influence cross-section results too".

## Intent

Consultants need a groundwater model they can defend: built from the boreholes, water levels, slug tests and lab results already in the project, calibrated to measured heads, and checked against later sampling. The cross-section and map should draw from it, so the water table, flow and plume between wells follow physics and layering instead of straight lines or a single uniform aquifer.

## Decided

- **Engine:** MODFLOW 6 6.8.1 (USGS, public domain, CC0-1.0), bundled as the official binary in the desktop app (`resources/mf6/<platform>/mf6`). It runs on the user's computer through a narrow desktop bridge. The hosted web version shows that the model needs the desktop app, and keeps the Domenico screening forecast.
- **Extent:** a 3D structured grid (DIS) over the site plus a margin. The grid is rotated so its columns run along the fitted flow direction.
- **Layers:**
  - one model layer per correlated soil unit (the cross-section's unit pairing, aliases included);
  - surfaces interpolated between boreholes by inverse distance;
  - a unit missing at a borehole thins to zero there and becomes a vertical pass-through cell (IDOMAIN −1);
  - the model bottom is the base of the logs, a no-flow boundary stated as a limit.
- **Hydraulic conductivity:** per unit, from slug tests screened in that unit (geometric mean); otherwise estimated by calibration. No textbook K is presented as site data. Kv/Kh is entered (default 0.1, marked "assumed").
- **Boundaries (builder's call, since the user didn't choose):**
  - automatic fixed heads (CHD) on the upgradient and downgradient faces, from the calibration round's fitted water-table plane;
  - no-flow on the faces parallel to flow;
  - plus user-entered features: river (RIV), drain (DRN), pumping well (WEL) or fixed head (CHD), at points or polylines with their values.
- **Recharge:** areal RCH, a start value from CCME (2008) defaults, calibrated.
- **Calibration:** Levenberg–Marquardt on log-transformed parameters (K per unit, recharge, boundary head shift), with slug-test K as prior information (regularisation), run by repeated MODFLOW 6 runs. The report gives:
  - residuals per well;
  - mean error, mean absolute error, RMSE and RMSE as a percentage of the head range;
  - percent mass-balance discrepancy;
  - composite scaled sensitivities;
  - the parameter correlation matrix;
  - linear 95 % intervals.

  It warns when K and recharge cannot be separated (|correlation| > 0.95).
- **Transient flow:** stress periods between the monitoring rounds, with specific yield per unit and recharge per period. Calibrated to all rounds when the user chooses it.
- **Transport:**
  - the MODFLOW 6 GWT model, with TVD advection, dispersion (αL, αTH, αTV) and linear sorption (Kd = Koc·foc, with the cited chemical table and CCME soil defaults);
  - first-order decay only when a half-life is entered;
  - a constant-concentration source at the source well's cells from the release date;
  - output at every round and yearly to the forecast horizon;
  - compared with measured concentrations, and the source concentration can be calibrated.
- **Flow paths:** pathlines and travel-time marks computed from MODFLOW 6's saved specific discharge.
- **Cross-section and map:**
  - the model's water table, head contours and flow arrows;
  - the MODFLOW 6 plume replaces the Domenico forecast and supplies the model-guided plume shape when a run exists; Domenico stays as an independent check and the fallback.
  - Everything is labelled "Model (MODFLOW 6), not measured" in the purple family, with the calibration round and fit stated.
- **Export:** the complete MODFLOW 6 input files and outputs as a zip for review in standard tools.
- **Verification (automated):**
  - flow between two fixed heads with recharge against the analytical solution;
  - 1-D transport against Ogata–Banks;
  - a twin experiment in which calibration recovers known parameters;
  - the binary readers against MODFLOW's own observation output;
  - mass balance below 1 %.

## Non-goals

Unstructured grids (DISV/DISU), density-driven flow, unsaturated zone (UZF), multi-species reactions, and automatic boundary inference from DEMs or hydrography.

## Anti-goals

- A model result shown without its calibration statistics and labels.
- A parameter value with no source shown as site data.
- Silently mixing measured and modelled values.

## Constraints

- Single-file `index.html` for the interface.
- Electron main process for running the binary, where the bridge accepts only model files and output names: no paths and no shell.
- Tests in `borehole-desktop/tests/app/run.mjs` run the real binary.
- DESIGN.md and PRODUCT.md rules apply.
