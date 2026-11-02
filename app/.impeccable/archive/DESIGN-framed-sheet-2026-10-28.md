---
name: Borehole Field Log
description: Field-to-issue borehole logging for Alberta and Saskatchewan consultants
colors:
  frame-field: "#f3f5f2"
  sheet: "#ffffff"
  raised: "#f4f6f4"
  active: "#e6e9e5"
  border: "#e3e6e2"
  rule: "#eef0ed"
  control: "#cdd1cc"
  ink: "#131416"
  muted: "#5a5e5b"
  primary: "#1d1f20"
  accent-teal: "#1b6c80"
  water: "#2f70bb"
  positive: "#1e7b4f"
  negative: "#c4242a"
  warning: "#92400e"
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
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  section:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  small:
    fontFamily: "IBM Plex Sans, Inter, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
  measurement:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  control: "6px"
  card: "8px"
  sheet: "16px"
  pill: "999px"
spacing:
  inset: "8px"
  gap: "24px"
  pad: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.active}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "32px"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.sheet}"
  panel:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.card}"
---

# Design System: Borehole Field Log

## Overview

**Creative North Star: "The Framed Sheet"**

Built with the design-taste-frontend app style "framed-sheet" (seed 417060375), restyled 2026-10-28. One tinted L-shaped frame holds the 48px top bar and a labelled 228px sidebar with no rule between them; the work sits on a white sheet inset 8px from the window's right and bottom edges, with 16px corners, a 1px edge and no shadow. The frame is a low-chroma green-grey taken from the prairie field. Colour lives on data only: soil fills and patterns on logs, water in blue, status pills, and the teal on the main data element. Buttons are near-black; the selected tab is a 2px ink underline.

**Key Characteristics:**
- Tinted frame, white sheet, one tone step of depth, no resting shadows.
- Labelled sidebar: views (Log, Data, PDF), then Project (Site & lab, Groundwater), Tools, then the project's boreholes.
- IBM Plex Sans throughout; IBM Plex Mono only for measured figures on log drawings.
- Near-black primary, outlined secondary, 32px controls, 6px corners.
- Office density; the guided field flow scales the same parts to 44-56px targets.

## Colors

The frame and sheet are neutral; every hue encodes something.

### Primary
- **Primary** (#1d1f20): the one filled action per region (Log borehole, Add layer, Next).
- **Accent teal** (#1b6c80): focus rings and the screen's main data element.

### Secondary
- **Water** (#2f70bb): water levels, seepage, flow arrows and equipotentials.

### Tertiary
- **Positive** (#1e7b4f), **Negative** (#c4242a), **Warning** (#92400e): status and validation, as pale pills with dark ink.

### Neutral
- **Frame field** (#f3f5f2), **Sheet** (#ffffff), **Raised** (#f4f6f4), **Active** (#e6e9e5): frame, work surface, quiet fills, selected nav and rows.
- **Border** (#e3e6e2), **Rule** (#eef0ed), **Control** (#cdd1cc): panel edges, table rules, input strokes.
- **Ink** (#131416), **Muted** (#5a5e5b): text, at 4.5:1 or better.

### Named Rules
**The Data-Only Hue Rule.** Hue appears on soil, water, status and the main data element; chrome stays grey and ink.

## Typography

**Body Font:** IBM Plex Sans (Inter, system-ui fallback). **Measurement Font:** IBM Plex Mono for figures on log drawings.

### Hierarchy
- **Title** (600, 22px): the borehole or project name.
- **Section** (600, 16px): panel headers.
- **Body** (400, 14px): forms, tables, nav.
- **Small** (500, 12.5px): labels, table headers, sidebar groups. Sentence case, no tracked capitals.
- **Measurement** (mono, 11px, tabular): log depths and ticks. Nothing on screen under 11px.

## Layout

Grid: sidebar 228px plus the fluid sheet; sheet padding 24px; one 24px gap between panels. Below 860px the frame folds: the nav wraps into a row under the top bar, the boreholes list follows, and the sheet becomes the screen with no inset. The side panel for log edits floats on the right (a bottom sheet on phones).

## Elevation & Depth

Depth is one tone step (frame to sheet) and 1px borders. Shadows only on what floats: menus, dialogs, the edit side panel, tooltips and toasts.

## Shapes

Controls 6px, panels 8px, sheet 16px, pills fully round.

## Components

- **Buttons:** primary near-black, secondary white with a Control border, link text in teal-ink; 32px (field 52-56px).
- **Sidebar items:** 32px rows, 16px outline icon and 14px label; selected = Active fill, label in ink.
- **Tabs:** 14px labels, selected in ink with a 2px ink underline on a 1px rule; counts as small grey pills.
- **Panels:** white, 1px Border, 8px corners, header 16/600 over a Rule line.
- **Inputs:** white, 1px Control, 6px corners, teal focus ring.
- **Tables:** grey 12.5px headers without bands, Rule lines, right-aligned tabular figures.

## Do's and Don'ts

### Do:
- **Do** keep the frame (#f3f5f2) and the white sheet the only two grounds.
- **Do** put hue only on data, water and status.
- **Do** keep every on-screen text at 11px or larger, sentence case.

### Don't:
- **Don't** use gradients, glows, glass or resting shadows.
- **Don't** use symbol characters as icons; draw them.
- **Don't** add a rule between the sidebar and the top bar.
- **Don't** add a dark theme; light only.
