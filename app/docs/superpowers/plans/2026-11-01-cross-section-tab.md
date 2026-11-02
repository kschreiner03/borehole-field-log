# Cross-section tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cross-section page on the left rail with honest layers and water, groundwater lab results, a measured plume over time (A) and a labelled Domenico forecast with built-in checks (B).

**Architecture:** All in `index.html`. A new tab `xsec` renders `xsecHTML()` and draws with the existing `drawSection`, which gains a time and plume layer (`S.xs` state). Plume contours reuse `delaunay`/`tinBands`/`tinLine` in section coordinates. The model is pure functions (`domenico`, `ogataBanks`, `leachSource`) fed by `gwFlow()` and a cited property table.

**Tech Stack:** vanilla JS/SVG; Electron checks in `borehole-desktop/tests/app/run.mjs` (`npm run sync-legacy` then `ONLY=<name> node scripts/test-app.mjs`; whole suite `npm run test:app`).

**Spec:** `docs/superpowers/specs/2026-10-31-cross-section-tab-design.md`

## Global Constraints

- Interpretation is dashed or hatched and labelled "interpreted"/"interpolated"; model output uses a separate colour family and the label "Model, not measured" on screen and in print.
- Media are never combined into one plume; units: soil mg/kg, groundwater mg/L, vapour ppm.
- Contours at guideline × 1, 10, 100; linear in log10 on a TIN; drawn only inside the data hull.
- Same round = readings or samples within 7 days of each other.
- Every chemical property carries value, unit and citation; a value not checked against its source is `null` and blocks the model for that parameter with a message naming it.
- Model must match Ogata–Banks (1961) within 1 % in the 1-D case; halving the evaluation grid moves contour positions < 1 % of section length.
- New data fields additive: `b.gwSamples`, `site.gwGuide`, `site.xsec`, `site.model`. Issued boreholes lock `gwSamples` like soil results.
- DESIGN.md (slate-teal selection only, Arial drawings, light theme).

## Review Focus

1. A project with no elevations (depth-only section): plume and water still draw on the depth axis; the model refuses (needs heads) with a message.
2. A chosen parameter with no results in the chosen medium: the drawing says so; no empty legend or NaN contours.
3. A project with one sampling date: the slider shows one stop and play is disabled.
4. Two boreholes at the same position on the line: no zero-width triangles or division by zero in the TIN or offsets.
5. Lab CSV for water in µg/L: imported as mg/L (÷1000) with the original unit kept in `labMeta`.

Tests for these are added in the owning tasks (marked RF1–RF5).

---

## Part A — measured data over time

### Task 1: Cross-section page on the rail
**Produces:** tab key `xsec` in `RAIL_PAGES` (after `contam`), `NAV_ICON.xsec`, `NAV_LABEL.xsec = 'Cross-section'`; `xsecHTML(): string`; `drawXsec(): void` (draws `#xs-draw`); the Map page's section panel replaced by a link `data-tab="xsec"`.
- [ ] Test "cross-section: page on the rail": `#prail [data-tab="xsec"]` exists between Lab and Reports; `goTab('xsec')` on the Lloyd example renders `#xs-draw svg`; the Map page contains `[data-tab="xsec"]` and no `#section`.
- [ ] Run, expect FAIL; implement (move section line chips and `secToolsHTML` here; `drawSite` stops drawing the section); run, expect PASS; commit `Cross-section: own page on the rail`.

### Task 2: Honest layers and ground
**Produces:** `secPos(bhs): [{b, d, off}]` (`off` = perpendicular distance in m from the section line, signed, 0 for boreholes on a chosen line); `site.xsec.alias: {[bhId + '|' + unit]: group}`; correlation joins units by `alias ?? unit`.
- [ ] Test "cross-section: offsets, interpreted ground and unit pairing": with a fitted line through three boreholes where one is 6 m off, its label contains "6.0 m" and "projected"; the ground path between boreholes has a dasharray and title "Ground surface interpolated between boreholes"; setting an alias joins two differently named units (a joining path exists between them). RF4: two boreholes at the same position give finite coordinates only.
- [ ] Run FAIL → implement (alias editor: per unit a select of groups in the page's Layers panel) → PASS → commit.

### Task 3: Honest water by date
**Produces:** `waterAt(b, date): {depth, kind, date} | null` (latest reading on or before `date`, preferring `static`); `S.xs = { date, medium, param, round, layers }` persisted to `bhlog.xs`.
- [ ] Test "cross-section: water by date": at a date between two monitoring rounds each well shows its earlier static reading as a solid tick; two wells are joined by a dashed path only when both are `static` and within 7 days; a `strike` is drawn as a triangle and never joined.
- [ ] Run FAIL → implement → PASS → commit.

### Task 4: Groundwater lab results
**Produces:** `b.gwSamples: [{id, date, sid, lab, report, res: {[param]: {v, lt}}, unit0}]` (normalised to `[]`); `gwVal(s, p)` (F1−BTEX computed as for soil); `site.gwGuide: {[param]: mg/L}`; a grid in Water & well (one row per sample, columns BTEX, F1, F2); lab CSV import with matrix water.
- [ ] Test "groundwater results: entry, guideline, import and lock": adding a row saves `gwSamples`; an issued borehole refuses the edit; RF5: importing a CSV row `MW-1, benzene, 12, ug/L` stores `{v: .012}` and `unit0: 'ug/L'`.
- [ ] Run FAIL → implement → PASS → commit.

### Task 5: Plume points and timeline
**Produces:** `xsDates(list): string[]` (sorted unique dates of lab results, groundwater samples and static readings); `plumePoints(pos, medium, param, date, round): [{b, d, top, bot, v, lt, date, age}]` (soil/vapour: `top = bot = sample depth`; groundwater: the screen below the water table at that date).
- [ ] Test "cross-section: plume points by date": on the Dawn Lake example, benzene soil points equal the soil samples with benzene results; a date before the sampling gives none; `round` hides results older than 7 days; RF3: a project with one date gives `xsDates().length === 1` and a disabled play button.
- [ ] Run FAIL → implement → PASS → commit.

### Task 6: Plume drawing, contours, slider
**Produces:** in `drawSection`, when `S.xs.layers.plume`: points coloured on a sequential ramp (hollow for non-detects), guideline contours ×1/10/100 from a TIN of `[d, elev, log10 v]` scaled so vertical and horizontal units match the drawn exaggeration, hull-clipped, hatched, titled "interpolated"; a legend with medium, parameter, date; slider `#xs-date` with stops at `xsDates`, play `#xs-play`.
- [ ] Test "cross-section: plume contours": every contour vertex lies inside the hull of plotted points; the ×1 contour separates a point above the guideline from one below it (sign check along the segment); RF2: a parameter with no results shows "No benzene results in groundwater" and no `path[data-contour]`; RF1: a depth-only project still draws the plume.
- [ ] Run FAIL → implement → PASS → commit.

### Task 7: Section on report pages keeps its settings
**Produces:** section items store `o.xs` (a copy of `S.xs` when placed or on "Use current view"); `itemInner` draws with it.
- [ ] Test "report: section item carries date and plume": a section item with `o.xs.date` prints that date and the "interpolated" label in its SVG.
- [ ] Run FAIL → implement → PASS → commit.

## Part B — forecast

### Task 8: Cited chemical properties
**Produces:** `CHEM: {[param]: {koc, H, sol, hl, src: {koc, H, sol, hl}}}` for benzene, toluene, ethylbenzene, xylenes, f1, f2 (units L/kg, dimensionless, mg/L, days); values transcribed from the sources named in the spec and checked against them during the build; unchecked values `null`.
- [ ] Test "model: properties are cited": every non-null value has a non-empty `src`; a `null` value makes `modelInputs('f2')` return `{missing: ['half-life']}`-style names.
- [ ] Run FAIL → implement → PASS → commit.

### Task 9: Transport solutions
**Produces:** `domenico({C0, v, ax, ay, az, R, k, Y, Z, x, y, z, t}): number` (Domenico 1987, vertical plane source width Y, depth Z, first-order decay k with the √(1+4kαx R/v) term); `ogataBanks({C0, v, D, R, x, t}): number` (full solution with both terms, `erfc` with |error| < 1e-7).
- [ ] Test "model: Domenico against Ogata–Banks and a published example": with Y, Z very large, ay = az ≈ 0 and k = 0, `domenico` equals the first term of `ogataBanks` within 1 % at 20 (x, t) pairs where x > 2·ax; `erfc` matches tabulated values (erfc(0.5) = 0.4795001222, erfc(1) = 0.1572992071, erfc(2) = 0.0046777350); the published worked example reproduces to its printed precision (source and values recorded in the test).
- [ ] Run FAIL → implement → PASS → commit.

### Task 10: Source from soil (ASTM E1739)
**Produces:** `leachSource({Cs, koc, foc, H, thw, tha, rhob, I, Ugw, dgw, W}): {Kd, LF, Cgw}` with Kd = koc·foc, Ksw = ρs / (θw + Kd·ρs + H·θa), LF = Ksw / (1 + Ugw·δgw/(I·W)), Cgw = Cs·LF (units checked: mg/kg → mg/L).
- [ ] Test "model: soil-to-groundwater source": a hand-computed case (values in the test with the arithmetic shown) matches to 4 significant figures; doubling recharge I raises Cgw; missing foc returns `{missing: ['foc']}`.
- [ ] Run FAIL → implement → PASS → commit.

### Task 11: Model layer on the section
**Produces:** `site.model = {param, src: 'gw'|'soil', srcBh, t0, Y, Z, foc, rhob, n, I, ax?, ay?, az?, k?}`; `modelGrid(pos, date, res): {cells, ...}`; points projected onto the flow azimuth from `gwFlow()` (downgradient x, cross-gradient y, depth below water table z); drawn as a different colour family with the label "Model, not measured" and the run date; inputs panel listing every value, unit and source, user edits marked "entered".
- [ ] Test "model: drawn on the section": the layer's SVG contains "Model, not measured"; halving the grid moves the ×1 contour's furthest downgradient point by < 1 % of section length; a point upgradient of the source has C = 0; RF1: no elevations → message "The forecast needs ground elevations to calculate heads."
- [ ] Run FAIL → implement → PASS → commit.

### Task 12: Checks panel
**Produces:** `modelChecks(): [{name, ok, detail}]` — units consistent; Ogata–Banks agreement (run live); published example; residuals against each later sampling round at each well (measured vs predicted, log difference); limits text (uniform soil, steady uniform flow, no NAPL, Domenico error at high dispersivity per West et al. 2007).
- [ ] Test "model: checks": with the Dawn Lake example and a later round, residual rows equal the number of wells sampled in that round; every check has `ok` boolean and a non-empty detail.
- [ ] Run FAIL → implement → PASS → full suite → commit.
