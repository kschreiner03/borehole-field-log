---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# Surface brief: application workspace (index.html)

Scope: the whole app UI (office screens, dialogs, menus, Quick Log). Mode: Operate.
Audience and job: office engineers and geologists completing, reviewing and issuing logs; field technicians in Quick Log at the rig.
Constraints: preserve every feature, calculation, data field and export; light theme only; field screens keep 44-56 px targets; log drawings and PDFs keep their own fonts and layout.
Confirmed 2026-10-30: native OS menu bar in the desktop app and an in-page menu bar in the browser; compact office density with big field mode; system UI font.

## Direction contract

THESIS: The borehole is the document. A conventional engineering desktop workspace (menu bar, toolbar, project tree, tabbed work area, status bar) where the selected borehole's data and its live log are one click apart. It refuses the SaaS dashboard: cards in cards, pills, oversized headings, frame-and-sheet chrome.
OWN-WORLD: cool neutral ground #F3F4F6, white panels, 1px #D5D9DF rules, one slate-teal #245B78 for primary action, selection and focus; soil and water hues only on data; system UI font at 13px; 3px controls, square panels and tables, 5px dialogs; 28px toolbar buttons, 30px inputs, 30px rows; no resting shadows.
STORY: open a project, pick a borehole in the tree, type intervals into the grid with depth checks, glance at the log, issue and export; save state and open issues always visible in the status bar.
FIRST VIEWPORT: menu bar, 36px toolbar, 248px project tree at left, work area with a 15px title row, tabs and the data grid, 24px status bar along the bottom.
FORM: the category standard, played straight. No concept roll was run: the direction was pinned by the user's brief (2026-10-30) and by PRODUCT.md's brand commitment (2026-10-28), and a pinned direction beats the roll. seed: none (roll skipped; direction pinned)
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
