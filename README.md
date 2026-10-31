# Borehole Field Log (desktop)

Windows and Mac desktop app: Electron + React + TypeScript + Vite.

- **Classic interface**: the current app (from `../borehole-log`), copied into `resources/legacy` by `npm run sync-legacy` and opened by default. It has native Open/Save dialogs, File menu shortcuts, recent documents, and opens `.bhp` / `.bhlog` files by double-click.
- **New interface (preview)**: React screens, opened from View > New interface (preview). They are being rebuilt screen by screen on the tested calculation modules in `src/core`.

## Commands

| | |
|---|---|
| `npm run dev` | Run the app with live reload |
| `npm test` | Calculation tests (Vitest) |
| `npm run test:app` | End-to-end checks of the classic interface in Electron, offline: every view, exports, saving, file opening, escaping |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Build into `out/` |
| `npm run dist:win` / `npm run dist:mac` | Runs both test suites, then builds installers in `dist/` (build each on its own platform) |

Smoke test: `BOREHOLE_SMOKE=shot.png npx electron .` opens the window, saves a screenshot and quits (`BOREHOLE_VIEW=preview` for the new interface; add a `.bhp` path to open it; `BOREHOLE_USER_DATA=<folder>` runs it in its own profile, beside a copy already open).

Running from a VS Code terminal: VS Code sets `ELECTRON_RUN_AS_NODE=1`, which stops Electron opening a window. Use `env -u ELECTRON_RUN_AS_NODE npm run dev`.

## Layout

- `src/core`: calculations with no UI (coordinates, SPT, soil classes, grain size, lab results, groundwater). Every function has tests in `tests/`.
- `src/main`: the desktop shell (window, menus, file dialogs, file associations).
- `src/preload`: the bridge the windows use for files and menu commands (`window.desktop`).
- `src/renderer`: the React interface.

## Signing and release

Unsigned installers work, but Windows SmartScreen warns about them and macOS refuses to open them without a right-click. electron-builder signs automatically when these are set in the environment:

- **macOS** (Apple Developer Program): a Developer ID Application certificate in the keychain (or `CSC_LINK` / `CSC_KEY_PASSWORD`), and for notarization `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Hardened runtime is on.
- **Windows**: a code-signing certificate as `CSC_LINK` (a .pfx path or base64) and `CSC_KEY_PASSWORD`, or Azure Trusted Signing.

Raise `version` in `package.json` for each release. The app icon is `build/icon.png` (1024 px, made from `build/icon.svg`).

## Saved data

The classic interface keeps boreholes, company settings and site plans in IndexedDB (database `bhlog-data`) and photos and imagery in IndexedDB `bhlog`, inside the app's profile folder. Older versions used local storage; their data moves across on first start. Project files (`.bhp`, `.bhlog`) are the copy to back up and share.
