# Reports phases 1, 3, 2, 5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the report page editor into a layout canvas (rulers, zoom, guides, snapping, multi-select and align), add true map furniture (scale bar, north arrow, legend, shapes), page setup (paper sizes, margins, title block fields) and PDF bookmarks.

**Architecture:** All in `index.html`'s report section. Page geometry stays in CSS px at 96 dpi (`PG`), now per page from a paper table. Map items record the scale they were actually drawn at (`RO.sc`, page px per metre) so a linked scale bar is exact. Export stays `buildReportBytes` (pdf-lib), adding page sizes per paper and an outline.

**Tech Stack:** vanilla JS, SVG, pdf-lib 1.17.1, pdf.js 3.11.174; Electron checks in `borehole-desktop/tests/app/run.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-30-reports-editor-design.md` (goals 2–5)

## Global Constraints

- Units on rulers and in the panel: mm (inches when the app is in imperial units). 1 mm = 96 / 25.4 px.
- A scale bar never states a scale the map does not have: it reads the linked map's drawn scale; ratio = PX_PER_M / sc, rounded to the nearest whole number.
- UTM maps are drawn grid-north-up; the north arrow says "Grid north" unless set to true north, which is rotated by the meridian convergence γ = atan(tan(λ − λ0)·sin φ) at the project centroid.
- Paper sizes in points: Letter 612×792, Legal 612×1008, Tabloid 792×1224, A4 595.28×841.89, A3 841.89×1190.55.
- Existing layouts, presets and templates render unchanged (Letter, existing margins, existing title block).

## Review Focus

1. A scale bar linked to a map set to "Fit to frame": the ratio and bar length follow the frame when it is resized.
2. A scale bar whose map is deleted: it says it has no map instead of drawing a wrong bar.
3. Zoom at 400 % on a large A3 page: rulers and guides stay aligned with the paper while scrolling.
4. Changing paper size with items placed: items stay on the page (clamped), nothing is lost.
5. Imperial units: rulers in inches, scale bar in feet with the same ratio.

---

### Task 1: Zoom, scrolling stage and rulers
**Produces:** `S.czoom` ('fit' | 'width' | number), `rulerTicks(len, z, unit)`; markup `.cmp-canvas` > `.rl-x`, `.rl-y`, `.cmp-scroll` > `.cmp-paper`.
- [ ] Test "report canvas: zoom and rulers": at `S.czoom = 2` the paper's rendered width is 2 × page px; the top ruler has a tick labelled 100 whose offset equals 100 mm × z from the paper's left edge.
- [ ] Implement: zoom control (Fit page, Fit width, 50/75/100/150/200/400 %), Ctrl/⌘+scroll zoom, rulers redrawn on scroll/zoom with a cursor marker.

### Task 2: Guides and snapping
**Produces:** `pg.guides = { x: number[], y: number[] }` (page px); `snapBox(pg, box, moving) -> {x, y, w, h, lines}`.
- [ ] Test "report canvas: guides and snapping": with a guide at y = 300, a box moved to y = 296 snaps to 300; a box near the body's left edge snaps to it; a box's left edge snaps to another item's right edge; tolerance 6 px / z.
- [ ] Implement: drag from a ruler to add a guide, drag a guide back onto the ruler to remove it, snap lines shown while dragging.

### Task 3: Multi-select, align and distribute
**Produces:** `S.cmulti: Set<string>`; `alignItems(how)` (left|hcenter|right|top|vcenter|bottom), `distributeItems(axis)` (h|v).
- [ ] Test "report canvas: multi-select, align and distribute": three items selected; `alignItems('left')` makes all x equal the smallest; `distributeItems('h')` makes the gaps equal (±1 px).
- [ ] Implement: Shift/Ctrl-click to add to the selection; dragging moves the selection; panel shows align/distribute buttons when two or more are selected.

### Task 4: Exact scale bar
**Produces:** item type `scalebar` with `o.link` (map item id), `o.units` (auto|m|ft); `RO.sc` set by `planSVG`/`mapFrame`; `pageItemsSVG(pg)`.
- [ ] Test "report: scale bar matches the map's real scale": a plan at 1:500 and a linked scale bar → label "1:500" and a 50 m bar exactly 50 × PX_PER_M / 500 px; with the plan on Fit to frame the ratio equals round(PX_PER_M / sc); with the map removed the bar says "No map linked".
- [ ] Implement alternating black/white segments (first segment subdivided), units m or ft, nice lengths.

### Task 5: North arrow, legend and shapes
**Produces:** item types `north` (`o.mode` grid|true), `legend`, `shape` (`o.kind` rect|ellipse|line|arrow, `o.stroke`, `o.fill`).
- [ ] Test "report: north arrow, legend and shapes": true-north arrow rotation equals the convergence for the project centroid (±0.05°); legend lists Borehole and Monitoring well for a project with both; an arrow shape renders a marker-tipped line.

### Task 6: Paper sizes and margins
**Produces:** `PAPERS`, `pg.paper`, `pg.margin` (mm); `pgDims(pg)` uses them; export page size per paper.
- [ ] Test "report: paper sizes": a free page on A3 landscape exports at 1190.55×841.89 pt; a Tabloid page at 792×1224; items clamp onto a smaller paper.

### Task 7: Title block fields
**Produces:** `pg.tb = { fig, drawn, checked, date, rev }`; `pageFrame` prints them; panel fields.
- [ ] Test "report: title block fields": the rendered frame contains the figure number, drawn/checked initials, date and revision.

### Task 8: Bookmarks
**Produces:** `buildReportBytes` writes an outline: one entry per layout page (its title), pointing at its first output page.
- [ ] Test "report: bookmarks": pdf.js `getOutline()` titles equal the layout page titles in order.
