# Settings panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A collapsible right-hand Settings panel shared by every page with view settings, a collapsible borehole list, and one tick list for log graphs.

**Architecture:** `index.html` only.
- The shell grid gets a fourth column `#ctl` (the panel).
- `CTL[tab]()` returns the page's groups `[{ id, title, icon, html }]`.
- `ctlRender()` draws them after every `renderView`; page HTML functions stop rendering those controls in the main area.
- Event handlers are already delegated on `document`, so moved controls keep their ids and `data-*` hooks and need no handler changes.

**Tech Stack:** vanilla JS and CSS in the single file; tests in `borehole-desktop/tests/app/run.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-02-settings-panel-design.md`

## Global Constraints
- **UI state:** stored in `localStorage` key `bhlog.ui` as `{ ctlOpen: bool, ctlW: number, sideOpen: bool, fold: { [groupId]: bool } }`, through the existing `jsonLS`/`lsSet`.
- **Panel width:** default 300 px, clamped 240–480; collapsed strip 40 px; collapsed side list 36 px.
- **Below 860 px:** the panel stacks under the main area, like `.side` does today.
- **Moved controls keep their ids and `data-*` hooks;** no handler logic changes except where a task says so.

## Review Focus
1. A page re-renders part of its controls in place (`$('#xs-model-sec').outerHTML = …`): it must still find them in the panel.
2. Switching pages with the panel collapsed: the strip shows the new page's group icons; a page with no groups shows no column.
3. Read-only (shared) projects: controls in the panel are disabled exactly as before.
4. A narrow window: no horizontal page scroll; the panel stacks below.
5. Old projects with `cols.lab` and `labGraph` set: their graph appears ticked, and unticking removes it.

---
### Task 1: Shell, panel and collapsible list
- [ ] Test "ui: settings panel and collapsible list":
  - on `xsec`, `#ctl` is visible with at least one `.ctl-g`;
  - clicking `[data-act="ctl-toggle"]` collapses it to a width of 40 ± 2 px with one `[data-ctlgo]` icon per group;
  - clicking an icon reopens it at that group (unfolded);
  - folding a group hides its body;
  - the state survives `renderView(true)` and is in `bhlog.ui`;
  - on `home`, `#ctl` is hidden;
  - `[data-act="side-toggle"]` makes `.side` 36 ± 2 px and `#main` wider by more than 150 px;
  - the panel width drag is clamped to 240–480.
- [ ] Implement `CTL`, `ctlRender()`, `S.ui`, CSS, the toggles and the resize handle. Commit.

### Task 2: Cross-section controls in the panel
- [ ] Test "ui: cross-section settings live in the panel":
  - `#ctl` contains `#xs-plume`, `#xs-medium`, `#sec-tools`, `#xs-model-sec` and `#xs-corr-sec`;
  - `#view` contains none of them but has `#xs-draw`, `#xs-asof` and `#xs-date`;
  - changing `#xs-medium` in the panel redraws the section;
  - the drawing's top is less than 260 px below the top of `#view`.
- [ ] Split `xsPlumeCtl` into the date strip (main) and the plume/show/style parts (panel). Register `CTL.xsec`. Commit.

### Task 3: PDF log preview settings and the graph tick list
- [ ] Test "ui: log graphs are one tick list":
  - `#ctl` has a Graphs group listing SPT N and each lab parameter with data, as `input[data-gtick]`;
  - ticking Toluene adds a Toluene column to `pageSVG`; unticking removes it;
  - a ticked graph is never in `pdfCols(b).dropped`;
  - with too many ticked, the group shows a "don't fit" note;
  - old settings `cols.lab = 'on'` with `labGraph` benzene show Benzene ticked.
- [ ] Move `rep-lay`, graphs and columns into `CTL.report`. Implement `gtickList()` over `S.co.cols` (field graphs) and `S.co.graphs` (lab and others), with `lab`+`labGraph` read as a ticked lab item. Ticked field graphs are set `'on'`, so they are never dropped. Commit.

### Task 4: 3D, Model, and Map & sections
- [ ] Test "ui: 3D, model and map settings in the panel":
  - 3D: `#v3d-ve` and the layer switches are in `#ctl`, and the canvas fills more than 85 % of `#view`'s width;
  - Model: `#gwm-setup` inputs and the run/calibrate buttons are in `#ctl`, and `#gwm-res` stays in `#view`;
  - Map & sections: `#sec-tools` is in `#ctl`.
  - Running from the panel still works (`gw-run` via the panel button with the mf6 preload).
- [ ] Register `CTL.v3d`, `CTL.gwm` and `CTL.site`, and remove those controls from the page HTML. Commit.

### Task 5: Tutorials follow the controls
- [ ] The existing tutorial test passes; steps whose target moved into the panel open the panel at the right group first (`st.ctl = groupId`).
- [ ] Full suite, final review, merge.
