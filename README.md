# Borehole Field Log

Borehole logging, groundwater and reporting, as a Windows and Mac desktop app (Electron + React + TypeScript + Vite).

- `app/`: the app itself, a single `index.html` (with `DESIGN.md`, `PRODUCT.md` and the design docs in `app/docs`). It also runs on its own in a browser.
- Everything else: the desktop shell, its tests and the installers.

- **Classic interface**: the app in `app/`, copied into `resources/legacy` by `npm run sync-legacy` and opened by default. It has native Open/Save dialogs, File menu shortcuts, recent documents, and opens `.bhp` / `.bhlog` files by double-click.
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
| `npm run package:win` / `npm run package:mac` | Builds the installer in `dist/` without the tests |
| `npm run release -- <version> --notes "…"` | Publishes an update: see Updates below |

## Building the Windows installer on a Windows computer

1. Install [Git](https://git-scm.com/download/win) and [Node.js](https://nodejs.org) (the LTS version), then open a new Command Prompt or PowerShell. Python is not needed.
2. Get the project and its packages:
   ```
   git clone https://github.com/kschreiner03/borehole-field-log.git
   cd borehole-field-log
   npm ci
   ```
3. Build the installer: `npm run dist:win`. It downloads MODFLOW 6 for Windows (checked against its published SHA-256), runs both test suites and writes the NSIS installer `dist\Borehole-Field-Log-Setup-<version>.exe`. It is a normal setup wizard: install for just this user or for everyone, choose the folder, Desktop and Start-menu shortcuts, an uninstaller in Settings › Apps, and `.bhp` / `.bhlog` files open in the app. Saved boreholes are kept when the app is uninstalled. The installer can also be built on a Mac with `npx electron-builder --win` after `node scripts/fetch-mf6.mjs win32-x64` and `npm run build`. To skip the tests: `node scripts/fetch-mf6.mjs win32-x64 && npm run build && npx electron-builder --win`.
4. Send the `.exe`. It is unsigned, so Windows shows "Windows protected your PC" the first time; choose **More info › Run anyway** (see Signing below to remove the warning).

To update later: `git pull`, then build again.

Smoke test: `BOREHOLE_SMOKE=shot.png npx electron .` opens the window, saves a screenshot and quits (`BOREHOLE_VIEW=preview` for the new interface; add a `.bhp` path to open it; `BOREHOLE_USER_DATA=<folder>` runs it in its own profile, beside a copy already open).

VS Code: open this folder (File › Open Folder… › `borehole-field-log`). Its `.vscode/settings.json` clears `ELECTRON_RUN_AS_NODE`, which VS Code's terminal otherwise sets and which stops Electron opening a window, so `npm run dev` works in the built-in terminal.

## Layout

- `src/core`: calculations with no UI (coordinates, SPT, soil classes, grain size, lab results, groundwater). Every function has tests in `tests/`.
- `src/main`: the desktop shell (window, menus, file dialogs, file associations).
- `src/preload`: the bridge the windows use for files and menu commands (`window.desktop`).
- `src/renderer`: the React interface.

## Signing and release

Unsigned installers work, but Windows SmartScreen warns about them and macOS refuses to open them without a right-click. electron-builder signs automatically when these are set in the environment:

- **macOS**: set up. `npm run dist:mac` signs with the Developer ID Application certificate for team UUUUG5QGQ9 (it must be in the login keychain) and notarizes with Apple, so the `.dmg` opens on any Mac without warnings. Notarization reads your Apple ID from a keychain profile named `borehole-notary`; create it once on each Mac you build on:
  ```
  xcrun notarytool store-credentials borehole-notary --apple-id <your Apple ID email> --team-id UUUUG5QGQ9
  ```
  It asks for an app-specific password (make one at account.apple.com › Sign-In and Security › App-Specific Passwords). The password stays in your keychain, never in the project. Without the profile the app is still signed but not notarized. Hardened runtime is on; builds are Apple Silicon (arm64), matching the MODFLOW 6 build.
- **Windows**: a code-signing certificate as `CSC_LINK` (a .pfx path or base64) and `CSC_KEY_PASSWORD`, or Azure Trusted Signing.

The app icon is `build/icon.png` (1024 px, made from `build/icon.svg`).

## Updates

The desktop app checks GitHub once a day when it starts (`src/main/updates.mjs`; it can be turned off under Help › Check for updates). When the latest [release](https://github.com/kschreiner03/borehole-field-log/releases) is newer than the app and has that computer's installer, a pop-up shows what is new; **Download** opens the download page, https://kschreiner03.github.io/borehole-field-log/ (`docs/index.html`, served by GitHub Pages from `main` › `/docs`). The page reads the latest release from GitHub when it opens, so it never needs editing. Nothing is installed by the app itself.

To publish an update, with `main` the same as on GitHub and nothing uncommitted:

1. On the Mac: `npm run release -- 0.2.0 --notes "One line on what is new"` (or `--notes-file notes.md`; lines starting `- ` become bullets). It sets the version, commits and pushes it, runs the quick tests, builds the signed and notarized `.dmg`, and creates the GitHub release `v0.2.0` with the installer and its SHA-256.
2. On the Windows computer: `git pull`, then `npm run release`. It builds the setup `.exe` and adds it, and its checksum, to the same release.

Until both are on the release, only people on the platform already there are told about the update. Add `--dry` to see what it would do. It needs the [GitHub CLI](https://cli.github.com) signed in (`gh auth login`) on each computer. Run `npm run test:app` before releasing; the release runs only the quick tests.

## Soil survey

The Soil page holds surface soil surveys, separate from boreholes: points with any number of depth samples, CSSC classification, particle size and lab results, entered in a grid, pasted from Excel, or imported (the survey CSV and lab files both work). A project can hold a survey with no boreholes at all.

- Maps: symbols, graduated circles, sand/silt/clay pies, heat maps, class zones and uncertainty, one depth at a time. The default method follows the number of points (under 5 none, 5–29 inverse distance or nearest point, 30+ kriging), and every setting can be changed, with warnings.
- Every surface is labelled "Interpolated, not measured" and shows a leave-one-out check. Colour stops where points are too far apart.
- `app/lib/soilstats.js` holds the statistics and has its own tests; `app/lib/soilsurvey.js` holds the page.
- Salinity limits in the app are marked unverified until each value has been checked against the published source and ticked in Settings › Limits.

## Saved data

The classic interface keeps boreholes, company settings and site plans in IndexedDB (database `bhlog-data`) and photos and imagery in IndexedDB `bhlog`, inside the app's profile folder. Older versions used local storage; their data moves across on first start. Project files (`.bhp`, `.bhlog`) are the copy to back up and share.
