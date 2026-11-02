# Reports phase 4: document assembly — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import PDFs and images into a report as pages, see every page as a thumbnail, reorder by dragging, rotate, delete, duplicate and insert pages, and export one PDF in which imported pages stay real PDF pages.

**Architecture:** A new page kind `pdf` (one per imported page) joins the existing report layout (`site.report.pages`). Imported files are stored with the photo store under the key `reportfile:<project>` and travel in `.bhp` files. pdf.js renders imported pages for thumbnails and the stage; pdf-lib assembles the export, copying imported pages and embedding the app's own pages as 300 dpi PNGs.

**Tech Stack:** Vanilla JS in `index.html`; pdf.js 3.11.174 (`window.pdfjsLib`) and pdf-lib 1.17.1 (`window.PDFLib`) in `lib/`; Electron end-to-end checks in `borehole-desktop/tests/app/run.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-30-reports-editor-design.md`

## Global Constraints

- Offline: `lib/pdf.min.js`, `lib/pdf.worker.min.js`, `lib/pdf-lib.min.js`; the hosted page loads them from cdnjs with these hashes:
  - pdf.min.js `sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e`
  - pdf.worker.min.js `sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2`
  - pdf-lib.min.js `sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI`
- Existing layouts, presets and company templates keep working unchanged; new fields are additive.
- Imported documents are never rasterised in the export.
- Look and copy follow DESIGN.md (3px controls, square panels, one slate-teal primary per view, sentence case).
- `build-local.py` maps the three CDN URLs to `lib/` like the existing libraries.

## Review Focus

1. A password-protected or corrupt PDF: import refuses it with a clear message and adds no pages.
2. A large PDF (100+ pages): import stays responsive (thumbnails render lazily, a progress toast) and the export keeps every page.
3. A project file saved and reopened on another computer: imported pages still render and export (the files travel in `.bhp`).
4. Deleting the last page that uses an imported file leaves no broken references; undo brings it back.
5. Rotating an imported landscape map page: the thumbnail, the stage and the exported page all show the same rotation.

---

### Task 1: Bundle the PDF libraries

**Files:**
- Create: `lib/pdf.min.js`, `lib/pdf.worker.min.js`, `lib/pdf-lib.min.js`
- Modify: `index.html` (head script tags), `build-local.py` (URL → `lib/` mapping)
- Test: `borehole-desktop/tests/app/run.mjs` (offline check)

**Interfaces:**
- Produces: `window.pdfjsLib` with `GlobalWorkerOptions.workerSrc` set to the worker beside it; `window.PDFLib`.

- [ ] **Step 1:** Extend the check "loads offline" with `expect(r.pdfjs && r.pdflib, …)` where `pdfjs: !!window.pdfjsLib, pdflib: !!window.PDFLib`.
- [ ] **Step 2:** Run `npm run test:app`; expect that check to FAIL.
- [ ] **Step 3:** Copy the three files into `lib/`, add the CDN `<script>` tags with integrity to `index.html`, set `pdfjsLib.GlobalWorkerOptions.workerSrc` relative to the page (`lib/pdf.worker.min.js` offline, the CDN URL hosted), add the mappings to `build-local.py`.
- [ ] **Step 4:** Run `npm run test:app`; expect all checks to PASS.
- [ ] **Step 5:** Commit `Reports: bundle pdf.js and pdf-lib for offline use`.

### Task 2: Import PDFs and images as pages

**Files:**
- Modify: `index.html` (report section near `RPAGES`, `newPage`, `saveProject`)
- Test: `borehole-desktop/tests/app/run.mjs`

**Interfaces:**
- Produces:
  - `RPAGES.pdf = 'Imported page'`; a page `{ id, kind: 'pdf', title, file: <fileId>, page: <1-based>, rot: 0|90|180|270 }`.
  - `async function importReportFiles(files: File[], at?: number): Promise<number>` — PDFs add one `pdf` page per page; images add a `free` page holding one `image` item that fills the body; returns pages added; inserts after `at` (default: after the current page).
  - `const REPORT_FILE_KEY = p => 'reportfile:' + p` — the photo-store owner key; records `{ id, bhId, name, kind: 'pdf', data: <data URL>, pages }`.
  - `async function reportFile(id): Promise<{ bytes: Uint8Array, doc }>` — cached loader (pdf.js document).

- [ ] **Step 1: Write the failing test** "report: imported PDF pages and images become pages and travel in the project file": build a 3-page PDF in the page with `PDFLib.PDFDocument.create()`, call `importReportFiles([new File([bytes], 'map.pdf')])`; assert 3 new pages of kind `pdf` with `page` 1,2,3 and the same `file`; import a PNG data URL as a File and assert one new `free` page whose single item is `image`; call `saveProject` with `saveTo` stubbed and assert the saved JSON's `photos` contain the `reportfile:` record; import `new File([new Uint8Array([1,2,3])], 'bad.pdf')` and assert it returns 0 and the page count is unchanged.
- [ ] **Step 2:** Run; expect FAIL (`importReportFiles` is not defined).
- [ ] **Step 3:** Implement as specified; refuse an unreadable or encrypted PDF with the toast “<name> could not be opened. It may be damaged or password-protected.”; add `REPORT_FILE_KEY(p)` to the ids `saveProject` and `backup` collect; add an “Add PDF or image…” button and a hidden file input accepting `.pdf,image/*`, multiple.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `Reports: import PDFs and images as pages`.

### Task 3: Page thumbnails and organising pages

**Files:**
- Modify: `index.html` (`composeHTML` side list, `composeAct`, `drawCompose`, CSS in the Engineering desktop layer)
- Test: `borehole-desktop/tests/app/run.mjs`

**Interfaces:**
- Consumes: `reportFile(id)` (Task 2).
- Produces:
  - `async function pageThumb(pg, w): Promise<string>` — a PNG data URL `w` px wide; `pdf` pages via pdf.js with `rot`; app pages from their first output page; cached by page id + content hash.
  - `function movePage(from: number, to: number)`; `composeAct` acts `cmp-rot-l`, `cmp-rot-r` (pdf pages: `rot` ±90; free pages: toggle orientation), existing `cmp-dup`, `cmp-delpage`.
  - `S.csort` — the page-sorter view (a grid of large thumbnails on the stage with multi-select by click / Shift / Ctrl-⌘, drag to reorder, Rotate / Duplicate / Delete for the selection).

- [ ] **Step 1: Write the failing test** "report: thumbnails, drag order, rotate and delete": after Task 2's import, assert the side list shows one `img` thumbnail per layout page; `movePage(last, 0)` makes the imported page first; `cmp-rot-r` twice gives `rot` 180; deleting all three pdf pages then `undo()` restores them.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement: the side list becomes thumbnails (number, title, page count for multi-page kinds) with pointer-drag reordering and a drop marker; a “Pages” / “Edit page” toggle above the stage switches to the sorter grid; the stage shows a `pdf` page as its rendered image inside a white sheet, rotated; thumbnails render lazily (IntersectionObserver) with a grey placeholder.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `Reports: page thumbnails, page sorter, drag order and rotation`.

### Task 4: Export with pdf-lib

**Files:**
- Modify: `index.html` (`buildReport`, `layoutPages`)
- Test: `borehole-desktop/tests/app/run.mjs`

**Interfaces:**
- Consumes: `reportFile(id)`, page `rot`.
- Produces: `async function buildReportBytes(L = repLayout()): Promise<Uint8Array>`; `buildReport()` saves its result as before (`<projNo>-report-<date>.pdf`).

- [ ] **Step 1: Write the failing test** "report: export keeps imported pages as real PDF pages": with the 3-page import plus the standard preset, `buildReportBytes()`; load the result with `PDFLib.PDFDocument.load` and assert the page count equals the layout's output page count, the imported pages carry their text (extract with pdf.js `getTextContent` on that page and find the string drawn in Step 1 of Task 2), and the rotated page's `getRotation().angle` is 180.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement: `layoutPages` yields `{ pdf: { file, page, rot } }` for imported pages; `buildReportBytes` copies those with `copyPages` (sources cached per file) and `setRotation(degrees(rot))`, and embeds every other page as `embedPng(await svgToPng(...))` on a page of its size in points (Letter 612×792, landscape swapped).
- [ ] **Step 4:** Run the whole suite; expect all checks to PASS.
- [ ] **Step 5:** Commit `Reports: assemble the export with pdf-lib`.
