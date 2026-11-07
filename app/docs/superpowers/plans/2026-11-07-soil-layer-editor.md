# Soil Layer Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The soil layer editor reads in classification order, holds the layer's samples with VOC and LEL, has one layer menu instead of seven buttons, and lets each person keep their own buttons.

**Architecture:** Rework `layerDetail()` and its handlers in `app/index.html` in place; steps come from one list (`LAYER_STEPS`). Personal buttons live in localStorage under `bhlog.buttons`.

**Tech Stack:** Single-file classic app, Electron app checks in `tests/app/run.mjs`.

**Spec:** `app/docs/superpowers/specs/2026-11-07-soil-layer-editor-design.md`

## Global Constraints

- Element ids and attributes used elsewhere stay: `#ldetail`, `#ld-<field>` (including `#ld-uscs`, `#ld-sub`), `data-qpick`, `data-chip`, `#lt-type`, `data-act="same-above"`.
- Descriptions of existing layers compose exactly as before unless the new plasticity override is set.
- Samples in the layer are `b.samples`; VOC is `cvc`, LEL is new `lel` (0–100).
- Personal buttons never go into project files or `S.co`.
- No new tab.

## Review Focus

1. A layer with no depths yet: the samples list says to enter depths first instead of listing every sample.
2. A sample typed with a depth in another layer: it moves there with a note, and is not lost from view without a word.
3. A personal button list saved empty for a step: the step falls back to the built-in buttons rather than showing none.
4. The Full log side panel (drawer) uses the same editor: it still opens, edits and redraws.
5. Issued borehole: steps, samples and the ⋯ menu are read only.

---

### Task 1: Data: LEL, jar, plasticity override

**Files:** Modify `app/index.html`; Test `tests/app/run.mjs`

**Interfaces:** Produces `sample.lel`, type `J` in `SAMPLE_TYPES`, `layer.pg` (plasticity or gradation words).

- [ ] **Step 1: Failing check** `layer editor: LEL, jar and plasticity`: `SAMPLE_TYPES.J === 'J – jar'`; `SAMPLE_ALIAS.JAR === 'J'`; a J sample draws on `logSVG`; a sample with `lel: 4` shows "LEL 4%" in the log hover text, appears in the Samples & lab form as `#s-<id>-lel`, in the `tests` data sheet as "LEL (%)" and the Excel Samples export; a `lel` graph series exists; `composeDesc({ uscs: 'CH', pg: 'medium plastic' })` uses the override and every existing example layer composes unchanged.
- [ ] **Step 2: Run** `ONLY='layer editor' npm run test:app`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Layer editor: LEL readings, jar samples, plasticity override`.

### Task 2: Classification order and one layer menu

**Files:** Modify `app/index.html`; Test `tests/app/run.mjs`

**Interfaces:** Produces `LAYER_STEPS = [{ k, label, kind: 'pick'|'multi'|'map', list(l) }]` for uscs, mods, pg, consistency, moisture, colour, other, origin; the ⋯ menu as `<details class="lmenu">` with `data-act` l-insert, l-dup, l-split, l-up, l-down, l-del.

- [ ] **Step 1: Failing check** `layer editor: one pass in classification order`: step labels in `#ldetail` read in the spec order 1–8; each `data-k` field appears once; no "All fields" fold; horizon and texture inside "Soil science names"; layer toolbar has only Add layer; ⋯ holds the six actions and each works; layer list rows have no ×; the Full log drawer opens the same editor and a chip edit redraws the log; an issued borehole shows the steps disabled and no ⋯ actions.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new check and the existing `ONLY='layer'` and `ONLY='log'` checks. Expected: PASS.
- [ ] **Step 5: Commit** `Layer editor: one pass in classification order, one layer menu`.

### Task 3: Samples in the layer

**Files:** Modify `app/index.html`; Test `tests/app/run.mjs`

**Interfaces:** Consumes Task 1 fields. Produces `layerSamples(b, l): number[]` (indexes into `b.samples`, top inclusive, bottom exclusive, plus any just added here), act `ls-add`, `ls-del`.

- [ ] **Step 1: Failing check** `layer editor: samples with VOC and LEL in the layer`: rows list exactly the samples in the layer; Add sample makes the next name and the last type, focuses Depth; typing VOC sets `cvc` and the vapour graph shows it; LEL sets `lel`; a depth below the layer moves it with a note naming the layer; a layer with no depths says to enter them first; the same samples show on Samples & lab.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Layer editor: samples with VOC and LEL in the layer`.

### Task 4: Your own buttons

**Files:** Modify `app/index.html`; Test `tests/app/run.mjs`

**Interfaces:** Produces `myButtons(k, builtIn): string[]`, `saveMyButtons(k, list | null)`, act `btn-save` (with `data-k`), dialog `openButtons()`.

- [ ] **Step 1: Failing check** `layer editor: your own buttons`: typing "trace mica" in the modifiers box adds it to the layer; Save as a button adds a chip that persists after reload; the Standard buttons dialog reorders and hides; Reset restores; an empty list falls back to built-ins; a soil line that is not a known symbol is refused with a message; nothing lands in `S.co` or project files; sample types use the list too.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Layer editor: your own buttons`.

### Task 5: Finish

- [ ] Screenshot the editor, the menu, the samples table and the dialog, light and dark; fix what looks wrong.
- [ ] `npm run typecheck`, `npm test`, `npm run test:app` alone.
- [ ] Commit.
