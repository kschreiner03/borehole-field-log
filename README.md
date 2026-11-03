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

Raise `version` in `package.json` for each release. The app icon is `build/icon.png` (1024 px, made from `build/icon.svg`).

## Saved data

The classic interface keeps boreholes, company settings and site plans in IndexedDB (database `bhlog-data`) and photos and imagery in IndexedDB `bhlog`, inside the app's profile folder. Older versions used local storage; their data moves across on first start. Project files (`.bhp`, `.bhlog`) are the copy to back up and share.
