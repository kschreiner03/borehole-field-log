# Borehole Field Log (desktop)

Windows and Mac desktop app: Electron + React + TypeScript + Vite.

- **Classic interface**: the current app (from `../borehole-log`), copied into `resources/legacy` by `npm run sync-legacy` and opened by default. It has native Open/Save dialogs, File menu shortcuts, recent documents, and opens `.bhp` / `.bhlog` files by double-click.
- **New interface (preview)**: React screens, opened from View > New interface (preview). They are being rebuilt screen by screen on the tested calculation modules in `src/core`.

## Commands

| | |
|---|---|
| `npm run dev` | Run the app with live reload |
| `npm test` | Calculation tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Build into `out/` |
| `npm run dist:win` / `npm run dist:mac` | Installers in `dist/` (build each on its own platform) |

Smoke test: `BOREHOLE_SMOKE=shot.png npx electron .` opens the window, saves a screenshot and quits (`BOREHOLE_VIEW=preview` for the new interface; add a `.bhp` path to open it).

Running from a VS Code terminal: VS Code sets `ELECTRON_RUN_AS_NODE=1`, which stops Electron opening a window. Use `env -u ELECTRON_RUN_AS_NODE npm run dev`.

## Layout

- `src/core`: calculations with no UI (coordinates, SPT, soil classes, grain size, lab results, groundwater). Every function has tests in `tests/`.
- `src/main`: the desktop shell (window, menus, file dialogs, file associations).
- `src/preload`: the bridge the windows use for files and menu commands (`window.desktop`).
- `src/renderer`: the React interface.
