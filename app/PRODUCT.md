# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff at one geotechnical and environmental consultancy working in Alberta and Saskatchewan (the firm's name, logo and "XTES #" project label print on every log).

- **Field technicians** log boreholes, test pits and monitoring wells on a tablet at the rig: soil layers, samples and SPT blow counts, vapour headspace, groundwater, well installation and drilling notes, often outdoors, in gloves, in bright light.
- **Engineers and geologists in the office** finish the details, add lab results, review, sign off and issue logs, then build report packages (PDF logs, location plans, cross-sections, lab summaries, Excel workbooks).

Both groups touch the same borehole: logged in the field, completed and issued in the office.

## Product Purpose

A full field-to-report program: turn what the field crew sees into issued, consultant-standard deliverables with no re-typing. That covers the borehole logs themselves and the reporting that follows each field day (what was drilled, sampled, installed and observed that day, ready to send), through to the project report package. Success is data entered quickly on site, checked and completed in the office, and issued as PDF or Excel reports that meet the firm's and the client's standards, with the same data reused for site plans, sections and groundwater monitoring.

## Positioning

Compared with gINT, HoleBASE or paper field sheets, all four of these hold at once:

- **Prairie standards built in.** CFEM / Modified USCS descriptions, consistency and compactness classes, CSSC soil horizons and texture classes, and official FGDC lithology patterns, plus Alberta and Saskatchewan conventions (LSD locations, NAD83(CSRS) UTM and 3TM, CGVD2013, CSA A23.1 sulphate classes), with no template setup.
- **Fast field logging.** A guided, big-button flow on a tablet (Setup, Soil, Samples, Water & well, Finish) that draws the log live as data goes in.
- **No install, works offline.** One HTML file that runs anywhere from a folder, plus a shareable online version with shared data.
- **Reports ready to issue.** Industry-layout PDF logs and Excel workbooks, report appendices, draft / review / issued status and revisions.

## Operating Context

- Field: tablet (landscape and portrait), solid- or hollow-stem auger rigs, environmental drilling with headspace vapour readings, monitoring well installation and purging (well volumes).
- Office: desktop browser, lab data entry, Excel import and export, AGS 4 export, GIS/CSV export, backup files.
- Projects group boreholes: one site plan image per project, cross-sections, monitoring rounds and report packages run per project.
- Typical projects: subdivision geotechnical investigations, Phase II ESA hydrocarbon delineation on oil and gas leases (for example near Lloydminster).

## Capabilities and Constraints

- Single self-contained HTML file; vanilla JS and SVG. Libraries from a CDN only: SheetJS, ExcelJS, jsPDF (bundled into `lib/` for the offline build).
- Local build: `build-local.py` writes `Borehole Log.html` and `Quick Log.html` (opens straight into the guided logging flow). Local data lives in browser storage; the published version stores shared data server-side.
- Soil surveys separate from boreholes: points and depth samples with CSSC classification, maps (heat maps, class zones, uncertainty) that state their method and accuracy, and texture, particle size and salinity graphs.
- Metric and imperial units; depth per PDF page; colour or black and white logs; selectable soil symbol standards (FGDC, CFEM, USCS/gINT, BS 5930, CSSC texture).
- Log columns are configurable (Auto / Always / Never); standard Canadian log layout with grouped headers, sample columns and SPT N, shear strength, water content / Atterberg and vapour plots.
- Light theme only (a firm requirement).
- Data must be accurate: classifications, corrections and calculations follow the cited standard; nothing on a log is invented or estimated without being labelled.
- Planned scope: post-field-day reporting (a daily field report built from the day's boreholes, samples, installations, water readings, notes, weather and crew). Its exact contents and format are undecided; confirm them with the user before building.

## Brand Commitments

- Company name, logo and project-number label ("XTES #") come from the firm's settings and appear on the app and every log.
- Logs follow the firm's conventional Alberta/Saskatchewan consultant layout; colour logs by default, black and white available.
- Light theme only.
- Visual direction: the category standard, played straight, at the craft level of Bentley OpenGround and Esri ArcGIS Field Maps / Survey123 (chosen 2026-10-28).

## Evidence on Hand

- Example data in the app: an Edmonton-area subdivision geotechnical investigation (3 boreholes) and a fictional Lloydminster-area Phase II ESA hydrocarbon delineation (10 boreholes, 5 monitoring wells, site drawing). Both are fictional and labelled as examples.
- No real client data, testimonials or performance claims exist; none may be fabricated.

## Product Principles

1. **Standards first.** Every term, class and symbol traces to a named standard (CFEM, CSSC, ASTM, FGDC, CSA); when a value is estimated, say so on the log.
2. **One entry, every output.** Data is entered once, in the field or the office, and flows to the log, the field-day report, PDF, Excel, plans, sections and monitoring without re-typing.
3. **The field comes first.** Anything a technician needs at the rig must work on a tablet with big targets, few steps and a live log.
4. **Issued means locked.** Status, revisions and history protect what has been issued to a client.
5. **Show the next step.** The app always makes clear what the borehole still needs and where to add it.

## Accessibility & Inclusion

- Outdoor tablet use: touch targets of at least 44 px in field screens, high contrast in bright light, no colour-only meaning (symbols and labels accompany colour).
- Logs must remain readable in black and white print.
