# Soil layer editor: one pass in classification order, samples in the layer, your own buttons

Date: 2026-11-07. Agreed with the user in conversation:
- "clean up the app for production … a section in the soil layers to add VOC reading in PPM and LEL just right there; there's a lot of jumping around and it's confusing";
- "clean up the soil layers section buttons, there's a lot of buttons; do it in the order that it would be classified";
- "we took VOC readings generally when we would get samples, so in the layer add it so you can add a SS custom name, put the depth and then if it's jar, auger cuttings etc., just easily accessible, no extra tab";
- layout A from the mockups (one column: describe in order, samples underneath);
- "can we type additional options for the buttons or create our own standard buttons … in settings";
- custom buttons are "just for the person";
- rework the existing editor in place ("re work").

## Intent

Logging a layer should be one pass down the screen, in the order the description is written, with the samples and their vapour readings taken in that layer right there. Today the same fields appear twice (quick buttons and an "All fields" fold), origin and other features are hidden, the toolbar has seven buttons plus row buttons, and vapour readings live on another tab. Each person should also be able to add the terms they use and hide the ones they don't.

## Goals

- The layer editor reads top to bottom in CFEM / Modified USCS order. Each field appears once.
- Samples within the layer's depths, with their own name, depth, type, VOC (ppm) and LEL (%), are listed and added in the layer.
- Fewer buttons: the toolbar keeps **+ Add layer**; the other layer actions go in one menu on the selected layer.
- Any step's buttons can be extended by typing, and each person can keep their own standard buttons.

## Non-goals

- No change to how descriptions are composed, printed or exported, beyond LEL being a new value.
- No new screen or tab. Blow counts, lab results and grain size stay on Samples & lab.
- No sharing of custom buttons between people or projects (they are per person).
- No change to the guided field logging (Log borehole) flow in this work.

## Anti-goals

It has failed if:
- a value can be entered in two places that disagree;
- a custom button can change a layer's soil symbol, pattern or legend without the person choosing a symbol;
- samples added in the layer differ from those on Samples & lab;
- existing projects open with any description changed.

## Approaches

1. **Rework the existing editor in place (chosen).** Steps and their buttons come from one definition. Element names the rest of the app uses stay (the Full log side panel, the typed description line, "Part of the unit above", `#ld-*` fields, `data-qpick`), so the log, side panel and tests keep working.
2. **Move the editor into its own file.** Cleaner main file, but the editor is wired into shared handlers (quick picks, typed text, field edits, the side panel); rewiring is a bigger, riskier change for the same visible result.
3. **Build it in the React interface.** That interface has no logging screens yet.

## Decided

### Layout (mockup A)

1. Layer list: From, To, Description. Toolbar: **+ Add layer** only. The row × goes.
2. Selected layer header: "Layer N · from–to", **Same as layer above**, and a **⋯** menu with Insert above, Duplicate, Split, Move up, Move down, Delete.
3. The description preview line, then the typed description line (kept as it is).
4. Steps, numbered, in this order:
   1. Soil (symbol)
   2. Modifiers
   3. Plasticity or gradation: shown from the symbol (as composed today), with an override for the layer.
   4. Consistency or compactness (only the states that fit the soil, as today)
   5. Moisture
   6. Colour
   7. Other features
   8. Origin
5. A small fold, **Soil science names**, for horizon and texture name. "Part of the unit above" (and its note field) and Cross-section unit sit with it.
6. **Samples in this layer**: Name, Depth, Type, VOC (ppm), LEL (%), and **+ Add sample**.

### Samples in the layer

- They are `b.samples` with depth from the layer's top to bottom (top inclusive). The same records as Samples & lab.
- **+ Add sample** creates one with the next name (the existing `nextSampleName`), the last type used, and depth left empty with the cursor in it.
- VOC writes the existing `cvc` field, so the vapour graph keeps working. LEL is a new field, `lel`, in percent of the lower explosive limit, 0–100.
- New sample type **J – jar**, drawn on logs like a grab sample, with its own entry in the key.
- A sample typed with a depth outside the layer is kept and moves to the layer it belongs in, with a note saying so.

### Your own buttons

- Each step, and sample type, ends with **+**: type a value, it goes into this layer, with **Save as a button** next to it.
- **Settings › Standard buttons**: per step, add, hide and reorder buttons; **Reset** restores the built-in set.
- Stored per person on this computer, never in project files or company settings.
- A custom soil-type button needs a symbol chosen when it is made.
- Built-in buttons keep their meaning. A custom term goes into the description as typed.

### LEL elsewhere

- Shown in the sample's hover note on the log, the sample form, Data tables and the Excel export.
- An optional LEL column on logs, Auto (shown when a borehole has LEL readings), like the other optional columns.

## Left to the builder

- Look of the ⋯ menu and the step numbers, in the app's existing style.
- Wording of notes and empty states.
- How the Settings page lists the steps.

## My calls, for checking

Not stated by the user:
- Plasticity override per layer, rather than always from the symbol.
- Horizon and texture name in a small fold rather than as steps.
- LEL as an optional log column.
- "Jar" as the name and J as the code.
- A sample at a layer's exact bottom depth belongs to the layer below.
