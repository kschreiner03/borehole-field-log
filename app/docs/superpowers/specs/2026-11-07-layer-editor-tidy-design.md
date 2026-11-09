# Layer editor, tidied: fold finished steps, one typing line everywhere

Date: 2026-11-07. Agreed with the user: "it feels cluttered"; mockup "Proposed" chosen ("i like the second yes"); "make it so we can type the whole layer description in all views".

## Intent
Describing a layer should show only what is being decided now. Everything already decided reads as one line, and the whole layer can be typed in one go wherever a layer is described.

## Decided
- **Typing line at the top of the editor** (the existing `#lt-type` reader, `parseLayerText` / `ltApply`), with "Reads as" underneath; Enter applies. It replaces the separate preview line. The Full log side panel uses this one instead of adding its own.
- **Steps fold.** A filled step is one line: ✓, name, value, "change". The open step is the one last chosen by "change", otherwise the first unfilled one; when all are filled, none is open. Plasticity counts as filled once a soil is chosen.
- **Short rows.** An open step shows up to 8 buttons: the selected ones first, then the person's most used (counted on this computer), then their button order. **More…** shows the full list (for Soil, every symbol). **+ other…** opens the step's typing box; **Save as a button** shows only when the box holds something that is not already a button.
- **Lighter buttons**: no border until hovered or selected.
- **Typing line in other views**: the guided Log borehole layer step, and the Data tables Soil layers sheet (its Description column becomes the typed reading, as on the Log & data layer list).
- Samples in this layer, the ⋯ menu and the fold for soil science names stay as built.

## Not changing
How descriptions compose, print or export; the order of the steps; what the buttons mean.

## Approaches
Change the existing editor in place (chosen, as for the first rework). A separate component would rewire shared handlers for no visible gain.

## My calls, for checking
- 8 buttons before More….
- Use counts kept per person on this computer, beside their own buttons.
- Plasticity treated as filled once there is a soil.
