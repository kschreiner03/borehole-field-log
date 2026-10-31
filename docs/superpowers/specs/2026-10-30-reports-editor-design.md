# Reports editor: Acrobat-style assembly and a real layout canvas

Date: 2026-10-30. Status: approved in conversation ("ok start"), option A, order 4 → 1 → 3 → 2 → 5.

## Intent

The Reports area should be where a consultant assembles the whole client package: the app's own pages (logs, plans,
sections, tables) together with outside documents (ArcGIS map exports, lab certificates, permits), laid out on a page
canvas that behaves like a layout program, and exported as one PDF. It must stay easy to use and follow DESIGN.md and
PRODUCT.md (light theme, standards first, issued means locked, nothing invented).

## Goals

1. **Document assembly (Acrobat-like):** import PDF files and images as pages; page thumbnails; drag to reorder; rotate,
   delete, duplicate and insert pages; page numbering across the whole package.
2. **Page canvas:** rulers on the top (x) and left (y) edges in mm, tracking zoom and scroll, with cursor and selection
   markers; zoom (fit page, fit width, 50–400 %, Ctrl/⌘+scroll); guides dragged out of the rulers; snapping to guides,
   margins, page centre and other items; multi-select, align and distribute.
3. **Map furniture as items:** a segmented scale bar (alternating blocks, a ratio such as 1:500, metres or feet) tied
   to a map item's real scale; a movable north arrow; a legend; shapes, arrows and callouts.
4. **Page setup:** paper sizes Letter, Legal, Tabloid (11×17), A4, A3; portrait or landscape; margins; an editable title
   block (figure number, drawn by, checked by, date, revision, plus company, project and number from settings).
5. **Export:** one PDF built with pdf-lib: imported PDF pages copied in as real (vector) pages, a PDF page placed as a
   figure embedded inside the app's frame, the app's own pages as 300 dpi images (vector later), bookmarks per page.

## Non-goals (this round)

- Editing the contents of imported PDFs (text, annotations, redaction).
- Vector output of the app's own drawings (planned improvement; images at 300 dpi for now).
- Collaboration or comments inside the editor.

## Anti-goals

- Imported documents degraded to blurry pictures in the final PDF.
- An editor that needs typing millimetres to place things.
- Anything that silently changes data on issued logs, or a figure that shows a scale it does not have.

## Constraints

- Offline: libraries bundled in `lib/` (pdf.js and pdf-lib, exact versions with integrity hashes for the hosted page).
- Imported files are stored like photos (IndexedDB locally, the artifact database when hosted) and travel in project
  files (.bhp) so a package can move between computers.
- The existing layout model (`site.report.pages`, items with x/y/w/h in CSS px on a 96 dpi page) stays readable; new
  fields are additive.
- Every existing report feature keeps working: page types, presets, company templates, per-item scales and options.

## Approaches considered

- **A. Real PDF pages (chosen).** pdf.js renders imported pages in the editor; pdf-lib assembles the export, copying
  imported pages as vector pages and embedding a PDF page inside a frame. Sharp, searchable, small files; about 1.5 MB more
  in `lib/`.
- B. Rasterise imported PDFs to images. No new libraries; loses sharpness and searchable text; large files.
- C. Append PDFs at the end of the export only. Easiest; no placement, thumbnails or reordering.

## Decided

- Option A; build order 4 → 1 → 3 → 2 → 5, each phase committed and tested.
- Units: mm on rulers and in the properties panel (inches when the app is in imperial units).

## Left to the builder

- Exact UI placement inside the existing three-part Reports layout (page list, canvas, properties), consistent with
  DESIGN.md.
- Snapping tolerance, guide storage per page vs per layout (builder's call: per page, with company templates keeping
  them).
