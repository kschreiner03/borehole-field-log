---
name: Borehole Field Log
description: Field-to-issue borehole logging for Alberta and Saskatchewan consultants
colors:
  ground: "#f3f4f6"
  surface: "#ffffff"
  raised: "#f7f8fa"
  hover: "#e8eff3"
  selected: "#dbe7ee"
  accent-soft: "#e5eef3"
  border: "#d5d9df"
  rule: "#e6e9ed"
  control: "#949eaa"
  button-line: "#b9c0c9"
  status-bar: "#eceef1"
  ink: "#1f2937"
  muted: "#576272"
  slate-teal: "#245b78"
  slate-teal-deep: "#1b4760"
  water: "#2867a8"
  positive: "#287a52"
  negative: "#b42318"
  warning: "#a3470b"
  soil-topsoil: "#8a6b4b"
  soil-fill: "#b9aca4"
  soil-gravel: "#d6ae66"
  soil-sand: "#ead08c"
  soil-silt: "#cbbb9c"
  soil-clay: "#a3afa8"
  soil-peat: "#5a4a39"
  soil-rock: "#9aa0a6"
typography:
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  section:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  status:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  drawing:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "11px"
    fontWeight: 400
rounded:
  control: "3px"
  menu: "4px"
  dialog: "5px"
  panel: "0px"
spacing:
  inset: "8px"
  gap: "12px"
  pad: "16px"
components:
  button-primary:
    backgroundColor: "{colors.slate-teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "{colors.slate-teal-deep}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 10px"
  button-secondary-hover:
    backgroundColor: "{colors.hover}"
  toolbar-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "28px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "30px"
  nav-item-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "28px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  panel-header:
    backgroundColor: "{colors.raised}"
    height: "34px"
  table-row:
    backgroundColor: "{colors.surface}"
    height: "30px"
  status-bar:
    backgroundColor: "{colors.status-bar}"
    textColor: "{colors.muted}"
    height: "24px"
---

# Design System: Borehole Field Log

## Overview

**Creative North Star: "The Borehole Is the Document"**

A conventional engineering desktop workspace, built 2026-10-30 to the user's brief and PRODUCT.md's commitment to the category standard played straight, at the craft level of Bentley OpenGround and Esri ArcGIS Field Maps. From top to bottom: a menu bar (File, Edit, View, Project, Boreholes, Tools, Reports, Help), a 40px toolbar with the project switcher and the find box, a 64px rail of project pages and a 272px borehole list at the left, the work area, and a 24px status bar along the bottom that always reports the save state, the project, the selected borehole and its problems, and the units. In the desktop app the menu bar is the operating system's, built from the same menu model the browser draws.

Colour does a job or stays out. The chrome is cool grey and white; one slate-teal marks the primary action, the current selection and keyboard focus; soil, water and status hues appear only on data. Panels and tables are square, controls are barely rounded, and only floating layers cast a shadow.

**Key Characteristics:**
- Cool grey ground, white panels, 1px rules, no resting shadows.
- One slate-teal for action, selection and focus.
- Square panels and tables, 3px controls, 4px menus, 5px dialogs.
- The system UI font at 13px for everything on screen; drawings in the export fonts.
- Compact office density (28px toolbar buttons, 30px inputs and rows); field mode and Quick Log keep 44–56px targets.

## Colors

The ground and panels are neutral; every hue encodes something.

### Primary
- **Slate Teal** (slate-teal): the one filled action in a view, the selected tab underline, checked chips, focus rings and menu highlight. **Slate Teal Deep** is its hover and pressed state.

### Secondary
- **Water** (water): water levels, seepage, flow arrows and equipotentials on drawings.

### Tertiary
- **Positive**, **Negative**, **Warning**: save state, validation and status, always with words beside them.
- **Soil fills** (soil-*): lithology on logs, sections and legends only.

### Neutral
- **Ground** (ground) behind the work area; **Surface** (surface) for panels, toolbar, tree and menus; **Raised** (raised) for panel headers, table headers and dialog bands; **Status bar** (status-bar).
- **Hover** (hover) and **Selected** (selected) for interactive rows; **Accent soft** (accent-soft) behind a checked chip.
- **Border** (border) for panel edges, **Rule** (rule) for table lines, **Button line** (button-line) for button strokes, **Control** (control) for input strokes.
- **Ink** (ink) and **Muted** (muted) for text, both at 4.5:1 or better on ground and surface.

### Named Rules
**The One Accent Rule.** Slate teal appears only on the primary action, selection and focus; a second filled primary in the same view is a defect.
**The Data-Only Hue Rule.** Soil, water and status colours live on data and status tags, never on chrome.

## Typography

**UI Font:** the system UI face (Segoe UI on Windows, San Francisco on macOS), so the app reads like the platform's own software. **Drawing Font:** Arial for labels and numerals and Courier New for Quick Log annotations, the same faces the PDF and Excel exports use, so the on-screen log matches what is issued.

### Hierarchy
- **Title** (600, 16px): the borehole or project name in the work area.
- **Section** (600, 13px): panel headers and dialog titles.
- **Body** (400, 13px, line height 1.4): forms, tables, tree, menus.
- **Label** (600, 12px, muted): field labels and table headers, sentence case.
- **Status** (400, 12px): the status bar and breadcrumbs.
- **Drawing** (Arial 11px): ticks and labels on logs and charts. Nothing on screen under 11px.

### Named Rules
**The Preview Is the PDF Rule.** Drawings on screen use the export's fonts; never restyle a drawing in the UI face.

## Layout

The shell is a fixed grid: menu bar, toolbar, then the 64px page rail, the 272px borehole list and the fluid work area, with the status bar fixed to the bottom. The work area sits on the ground with 16px padding and a 12px gap between panels; each view opens with breadcrumbs, a title row with its page tools at the right, a one-line facts row, then panels. The tree and the work area scroll independently. Below 1100px toolbar labels collapse to icons; below 1280px the status bar drops the project and units segments; below 860px the rail becomes a row and the list stacks above the work area.

## Elevation & Depth

Depth is one tone step (ground to surface) and 1px borders. Only floating layers carry a shadow: menus and the toolbar's drop-downs (soft, 6px offset), dialogs and the find palette (16px offset), the edit side panel and toasts.

### Named Rules
**The No Resting Shadow Rule.** Anything that sits in the layout is drawn with a border, never a shadow.

## Shapes

Barely rounded controls (3px) for buttons, inputs, chips, status tags and tree rows; menus at 4px; dialogs at 5px; panels, tables, grid cells and the work area square. Circles only where the shape is the meaning: the save-state dot, borehole and well glyphs, numbered workflow steps.

## Components

### Buttons
- **Primary:** slate teal fill, white label, 28px tall; one per view.
- **Secondary:** white with a button-line stroke; hover takes the hover tint and a darker stroke.
- **Toolbar:** flat until hovered, then a hover tint and border; separators group New borehole and Save, Undo and Redo, Log borehole and PDF.
- **Link:** slate teal text with a quiet underline, for navigation inside text.

### Chips
Soil types, modifiers, consistency, moisture and colour pick lists in the soil editor: 26px, 3px corners; checked chips take accent soft with a slate teal edge and semibold label (40px in field mode).

### Cards / Containers
Panels are white, square and bordered, with a raised 34px header band holding the title at the left and its tools at the right. Panels never nest.

### Inputs / Fields
30px, white, control stroke, 3px corners; hover darkens the stroke; focus takes a slate teal stroke with a soft 2px ring; read-only and disabled fill with raised. Labels sit above in the label style.

### Navigation
- **Page rail:** Overview, Borehole (the selected borehole's Log & data), Map, Tables, Water, Lab and Reports, each a 20px outline icon over an 11px label; the current page takes the selected fill and slate-teal-deep label.
- **Borehole list:** the project's boreholes with a filter box, status chips with counts (All, Draft, Review, Issued, Wells), a sort (Name, Depth, Vapour) and, per row, the borehole glyph, name, status tag and a muted line of depth, latest water and peak vapour. Choosing a borehole opens it in Log & data.
- **Toolbar:** the project switcher sits after the app name; the find box (⌘K / Ctrl+K) sits before Settings.
- **Tabs** in the work area use a 2px slate teal underline on a full-width rule.

### Data grid
Spreadsheet editing for layers, samples, tests and water readings: borderless 28px cells with ellipsis and full-value tooltips, a raised sticky header, the borehole column pinned, an inset slate teal outline on the focused cell, visible scrollbars, and problem cells tinted with their message on hover. It can be scoped to one borehole or the whole project.

### Borehole workspace
A borehole opens in Log & data: the data tabs (Details & photos, Soil & observations, Samples & lab, Water & well) on the left with a one-borehole grid at the top of each section, and the live log in a sticky, resizable pane on the right (the divider drags or takes the arrow keys; its width is remembered). Soil layers are a narrow list (From, To typed in place, the finished description) with the pick panel always open beneath it for the selected layer: soil, modifiers, consistency, moisture, colour and origin are clicked, not typed. Samples and water readings are typed straight into grids. Enter on the last row starts the next one. The fuller editor for a selected sample or reading (lab results and grain size, reading details) folds under its grid and follows the cursor. Clicking a layer on the log puts the cursor in its row. The full log sheet and the PDF preview are one click away in the pane header. Below 1180px the log stacks under the data.

### Status bar
Save state with a coloured dot and words (saved, saving, not saved), project, borehole with status and revision, a clickable problem count, units and symbol set, borehole count.

### Status tags
Draft, For review and Issued as square tinted tags with dark ink and a matching stroke, always worded.

## Do's and Don'ts

### Do:
- **Do** keep ground and surface the only two grounds, with raised for headers.
- **Do** give each view one filled primary action.
- **Do** report save state and problems in the status bar, in words.
- **Do** keep field mode and Quick Log targets at 44px or more.

### Don't:
- **Don't** use pills, gradients, glows, glass or resting shadows.
- **Don't** nest panels or round panels and tables.
- **Don't** draw icons with text characters; draw them as SVG.
- **Don't** restyle log drawings in the UI font.
- **Don't** add a dark theme; light only.
