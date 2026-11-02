# Settings panel and a bigger work view

Date: 2026-11-02. Agreed with the user in conversation:
- "could it be a settings panel like arcgis thats on the right that you can minimize";
- "i like have the work view bigger";
- the panel holds both what is shown and the page setup (recommended, accepted);
- the borehole list on the left collapses too ("sure lets do it").

## Intent

The drawing, map, log or 3D view should get most of the window. Today each page stacks rows of tick boxes and menus above its drawing, each page differently, and graphs on the borehole log are chosen in three places, so a chosen graph can still be missing from the PDF. One panel on the right, the same on every page that has settings, fixes both.

## Decided

- **Right panel ("Settings"):**
  - a column on the right of the window, about 300 px, drag its left edge to resize (240–480 px);
  - collapses with one click to a 40 px strip of group icons; clicking an icon opens the panel at that group;
  - groups fold on their own (like ArcGIS's panes); open or folded is remembered per group;
  - open/collapsed and width are remembered for the whole app (not per page), across restarts;
  - pages with no settings show no panel column.
- **Left borehole list:** collapses to a 36 px strip with an expand button and the borehole count; remembered.
- **Stays with the drawing:** only what is used while looking: on the Cross-section page the As-of date and the date slider, in one slim strip above the drawing.
- **Moves into the panel:**
  - Cross-section: plume (medium, parameter, round), show (units, water, wells…), style (shape, colours, height, borehole width, exaggeration), section line, forecast settings, layer correlation.
  - PDF log preview: page layout (depth per page, text size, column widths), log columns, graphs.
  - 3D view: layers, vertical exaggeration, reset, save and export buttons.
  - Model page: grid and setup inputs, parameters and units, boundary features, run / calibrate / transport buttons. Results (fit, residuals, scatter, tables) stay in the main area.
  - Map & sections: the section tools and map layer choices.
- **Graphs on the borehole log become one tick list** in the panel's Graphs group:
  - every value with data in the project, grouped Field tests (SPT N, shear strength, water content, vapour) and Lab results (each parameter), then other measured values;
  - ticked = shown, on screen and in the PDF; each ticked graph has its style (line, points, bars…) and scale;
  - a graph you ticked is never dropped from the PDF; when the page is too crowded the group says which graphs don't fit and suggests narrower graphs or fewer;
  - replaces the "Lab result graphed" menu, the "Extra graphs" rows and the test-graph tick boxes. Existing projects keep their choices.
- **Everything keeps working** as it does now: the same controls, values and saved settings, only in a new place.

## Approaches considered

1. **One shared panel built by the shell; each page supplies its groups (chosen).** One look and behaviour everywhere, and pages only change where their controls are rendered. Costs a pass over each page.
2. Per-page side columns inside each page. Simpler per page, but every page would look and collapse differently, against the point of the change.
3. Floating panel over the drawing. No layout change, but it covers the drawing it controls.

## Non-goals

Docking the panel left or floating it, per-page panel widths, panels on pages that have no view settings (Overview, Tables, Lab, Water, Reports editor, which has its own properties column).

## Anti-goals

A setting that disappears or stops working in the move; a graph the user chose silently missing from the PDF.

## Left to the builder

Icons per group, exact strip styling within DESIGN.md, the narrow-window behaviour (below 860 px the panel stacks under the page like the side list does today).
