import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type MenuItemConstructorOptions } from 'electron';
import { readFileSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { mf6Binary, runMf6 } from './mf6run.mjs';
import { gisStatus, gisInstall, gisRemove, gisRun, gisCancel, gisRegisterFile, gisFilePath } from './gis.mjs';
import { stat, copyFile } from 'node:fs/promises';
import { clearCreds, fetchSnapshot, loadCreds, saveCreds } from './applemaps.mjs';
import { checkForUpdate, HUB } from './updates.mjs';
import { fileGuard } from './guard.mjs';

/* The desktop shell. The current interface ("classic") runs from resources/legacy; the React interface is being
   built alongside it and opens from View > New interface (preview). Project files are ordinary files on disk. */
const isMac = process.platform === 'darwin';
// tests run in their own profile, beside a copy already open
if (process.env.BOREHOLE_USER_DATA) app.setPath('userData', process.env.BOREHOLE_USER_DATA);
const PROJECT_EXT = ['bhp', 'bhlog', 'bh', 'json'];
const FILTERS: Record<string, Electron.FileFilter[]> = {
  bhp: [{ name: 'Borehole project', extensions: ['bhp'] }],
  bhlog: [{ name: 'Borehole workspace', extensions: ['bhlog'] }],
  bh: [{ name: 'Borehole', extensions: ['bh'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  xlsx: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
};
let win: BrowserWindow | null = null;
// project files the person opened or saved through the shell: the only ones written without a dialog. The list is the shell's own,
// in its profile folder, so the window cannot add to it; it survives restarts so a linked project keeps saving in place
const knownFile = () => join(app.getPath('userData'), 'project-files.json');
const files = fileGuard(process.platform, (() => { try { return JSON.parse(readFileSync(knownFile(), 'utf8')); } catch { return []; } })());
const remember = (path: string) => { if (files.remember(path)) writeFile(knownFile(), JSON.stringify(files.list())).catch(() => undefined); };
let rendererReady = false;
let quitting = false;
const queued: string[] = [];   // project files opened from the OS before the window was ready

function createWindow(view: 'classic' | 'preview' = 'classic') {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1000, minHeight: 640, title: 'Borehole Field Log', show: false,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win?.show());
  // smoke test: BOREHOLE_SMOKE=<png path> loads the window, saves a screenshot and quits
  if (process.env.BOREHOLE_SMOKE) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    const img = await win!.webContents.capturePage(); await writeFile(process.env.BOREHOLE_SMOKE!, img.toPNG());
    const probe = await win!.webContents.executeJavaScript('JSON.stringify({ desktop: !!window.desktop, title: document.title, err: window.__err || null })');
    console.log('SMOKE', probe, 'MENU', JSON.stringify(Menu.getApplicationMenu()?.items.map(i => `${i.label}(${i.submenu?.items.length ?? 0})`)));
    app.quit();
  }, 3500));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // the window only ever shows the app: outside pages would get the file bridge
  const w = win;   // switching views replaces `win` before this window's close event fires
  w.webContents.on('will-navigate', (e, url) => { if (url !== w.webContents.getURL()) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  // let the page write any save still waiting (local storage and the linked project file) before the window goes; give up after 5 s
  let flushed = false;
  w.on('close', e => {
    if (flushed) return;
    e.preventDefault(); flushed = true;
    Promise.race([w.webContents.executeJavaScript('window.flushSaves?.()'), new Promise(r => setTimeout(r, 5000))]).catch(() => undefined)
      .then(state => {
        // a change that could not be saved anywhere is never closed away silently
        if (state === 'unsaved' && !w.isDestroyed() && dialog.showMessageBoxSync(w, { type: 'warning', buttons: ['Keep open', 'Close without saving'], defaultId: 0, cancelId: 0,
          message: 'Some changes could not be saved.', detail: 'Storage on this computer is full or blocked. Keep the window open and use File › Save project to keep your work in a file.' }) === 0) { flushed = false; quitting = false; return; }
        if (!w.isDestroyed()) w.close(); if (quitting) app.quit();   // holding the close cancelled a quit: carry it on
      });
  });
  rendererReady = false;
  if (view === 'classic') win.loadFile(join(app.getAppPath(), 'resources/legacy/index.html'));
  else if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

async function sendFile(path: string) {
  if (!PROJECT_EXT.includes(extname(path).slice(1).toLowerCase())) return;
  if (!win || !rendererReady) { queued.push(path); return; }
  try { win.webContents.send('open-file', { path, name: basename(path), text: await readFile(path, 'utf8') }); remember(path); app.addRecentDocument(path); }
  catch (e) { dialog.showErrorBox('Could not open the file', `${path}\n\n${(e as Error).message}`); }
}

ipcMain.on('renderer-ready', () => { rendererReady = true; for (const p of queued.splice(0)) sendFile(p); });

/* save: write to the remembered path, or ask where (Save as, or the first save) */
ipcMain.handle('file:save', async (e, o: { name: string; data: ArrayBuffer; path?: string | null; saveAs?: boolean }) => {
  if (e.sender !== win?.webContents) return null;
  // writing without asking is only for a project file the person opened or saved here; anything else goes through the dialog
  let path = !o.saveAs && files.canWrite(o.path) ? o.path! : null;
  if (!path) {
    const ext = extname(o.name).slice(1).toLowerCase();
    const r = await dialog.showSaveDialog(win!, { defaultPath: o.name, filters: FILTERS[ext] || [{ name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePath) return null;
    path = r.filePath;
  }
  await writeFile(path, Buffer.from(o.data));
  remember(path);
  if (/\.(bhp|bhlog)$/i.test(path)) app.addRecentDocument(path);
  return { path, name: basename(path) };
});

/* MODFLOW 6: the page sends model files (plain names, text only) and gets the listed outputs back; nothing else reaches the shell */
ipcMain.handle('mf6:run', async (e, o: { files: Record<string, string>; outputs?: string[] }) => {
  if (e.sender !== win?.webContents) return { ok: false, error: 'Not allowed.' };
  return runMf6({ bin: mf6Binary(app.getAppPath()), files: o?.files, outputs: Array.isArray(o?.outputs) ? o.outputs : [] });
});

/* GIS engines (optional, per user): status, install with progress, remove, and one job at a time from a fixed list of methods */
const gisCtx = () => ({ userData: app.getPath('userData'), root: app.getAppPath() });
ipcMain.handle('gis:status', async e => e.sender !== win?.webContents ? null : gisStatus(gisCtx()));
ipcMain.handle('gis:install', async e => { if (e.sender !== win?.webContents) return { ok: false, error: 'Not allowed.' }; const wc = e.sender; return gisInstall({ ...gisCtx(), onProgress: p => { if (!wc.isDestroyed()) wc.send('gis:progress', p); } }); });
ipcMain.handle('gis:remove', async e => e.sender !== win?.webContents ? { ok: false, error: 'Not allowed.' } : gisRemove(gisCtx()));
ipcMain.handle('gis:run', async (e, job: unknown) => { if (e.sender !== win?.webContents) return { ok: false, error: 'Not allowed.' }; const wc = e.sender; return gisRun({ ...gisCtx(), job, onProgress: p => { if (!wc.isDestroyed()) wc.send('gis:jobprogress', p); } }); });
ipcMain.handle('gis:cancel', async (e, id: unknown) => e.sender === win?.webContents && typeof id === 'string' ? gisCancel(id) : false);
// an elevation model chosen here, in the shell's own Open dialog: the window gets a token for it, not its path
ipcMain.handle('gis:pick', async (e, what: unknown) => {
  if (e.sender !== win?.webContents || !win) return null;
  const r = await dialog.showOpenDialog(win, what === 'lidar'
    ? { title: 'Open a lidar point cloud', properties: ['openFile'], filters: [{ name: 'Lidar point clouds', extensions: ['las', 'laz', 'zlidar'] }, { name: 'All files', extensions: ['*'] }] }
    : what === 'csv' ? { title: 'Open a table', properties: ['openFile'], filters: [{ name: 'Tables', extensions: ['csv', 'txt'] }, { name: 'All files', extensions: ['*'] }] }
    : what === 'vector'
    ? { title: 'Open a GIS layer', properties: ['openFile'], filters: [{ name: 'GIS layers', extensions: ['shp', 'gpkg', 'kml', 'kmz', 'geojson', 'json', 'dxf', 'csv', 'gml', 'tab', 'mif', 'gpx', 'fgb'] }, { name: 'All files', extensions: ['*'] }] }
    : what === 'image' ? { title: 'Open an image to georeference', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif', 'webp', 'jp2'] }, { name: 'All files', extensions: ['*'] }] }
    : what === 'raster' ? { title: 'Open a raster', properties: ['openFile'], filters: [{ name: 'Rasters', extensions: ['tif', 'tiff', 'img', 'asc', 'vrt', 'jp2', 'ecw', 'sid', 'nc', 'bil', 'flt', 'png', 'jpg'] }, { name: 'All files', extensions: ['*'] }] }
    : { title: 'Open an elevation model', properties: ['openFile'], filters: [{ name: 'Elevation models', extensions: ['tif', 'tiff', 'asc', 'img', 'dem', 'vrt', 'bil', 'flt', 'nc', 'xyz'] }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0], st = await stat(p).catch(() => null);
  return gisRegisterFile(p, basename(p), st?.size ?? 0);
});

// a file a WhiteboxTools tool made (a lidar file): saved where the user chooses, by its token
ipcMain.handle('gis:savefile', async (e, token: unknown, name: unknown) => {
  if (e.sender !== win?.webContents || !win || typeof token !== 'string') return null;
  const src = gisFilePath(token); if (!src) return null;
  const r = await dialog.showSaveDialog(win, { title: 'Save the file', defaultPath: typeof name === 'string' ? name.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120) : basename(src) });
  if (r.canceled || !r.filePath) return null;
  await copyFile(src, r.filePath); return { name: basename(r.filePath) };
});

/* Apple Maps: the key is set up and kept here (the app's own folder); the page asks for pictures of areas and gets images back */
const appleFile = () => join(app.getPath('userData'), 'apple-maps.json');
ipcMain.handle('apple:status', async e => { if (e.sender !== win?.webContents) return null; const c = await loadCreds(appleFile()); return c ? { teamId: c.teamId, keyId: c.keyId } : null; });
ipcMain.handle('apple:setup', async (e, c: unknown) => e.sender !== win?.webContents ? { ok: false, error: 'Not allowed.' } : c ? saveCreds(appleFile(), c) : (await clearCreds(appleFile()), { ok: true }));
ipcMain.handle('apple:snapshot', async (e, q) => {
  if (e.sender !== win?.webContents) return { ok: false, error: 'Not allowed.' };
  try { return await fetchSnapshot(q, await loadCreds(appleFile())); } catch (err) { return { ok: false, error: (err as Error).message }; }
});

/* updates: the newest release on GitHub against this version; the download page opens in the person's browser */
ipcMain.handle('update:check', async e => e.sender !== win?.webContents ? { ok: false, error: 'Not allowed.' } : checkForUpdate({ current: app.getVersion(), platform: process.platform }));
ipcMain.handle('update:open', async e => { if (e.sender === win?.webContents) await shell.openExternal(HUB); });

/* vector PDF: the window's page drawings (standalone SVG) printed by Chromium, so text stays real text that can be selected and
   edited in Acrobat; each page keeps its own paper size (inches). The print window runs no scripts and is closed straight after */
type PdfPage = { svg: string; w: number; h: number };
const isPages = (p: unknown): p is PdfPage[] => Array.isArray(p) && p.length > 0 && p.length <= 2000 && p.every(x => x && typeof x.svg === 'string' && x.w > 0 && x.w < 100 && x.h > 0 && x.h < 100);
ipcMain.handle('pdf:svg', async (e, o: { pages?: unknown }) => {
  if (e.sender !== win?.webContents) return { ok: false, error: 'Not allowed.' };
  const pages = o?.pages; if (!isPages(pages)) return { ok: false, error: 'No pages to print.' };
  const css = pages.map((p, i) => `@page p${i}{size:${p.w}in ${p.h}in;margin:0}.p${i}{page:p${i};width:${p.w}in;height:${p.h}in}`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}.pg{overflow:hidden;break-after:page}.pg:last-child{break-after:auto}.pg>svg{display:block;width:100%;height:100%}${css}</style>` + pages.map((p, i) => `<div class="pg p${i}">${p.svg}</div>`).join('');
  const file = join(app.getPath('temp'), `bhlog-print-${process.pid}-${Date.now()}.html`);
  const pw = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await writeFile(file, html); await pw.loadFile(file);
    const data = await pw.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    return { ok: true, data };
  } catch (err) { return { ok: false, error: (err as Error).message }; }
  finally { pw.destroy(); unlink(file).catch(() => {}); }
});
ipcMain.handle('file:open', async e => {
  if (e.sender !== win?.webContents) return null;
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Borehole project, workspace or borehole', extensions: PROJECT_EXT }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const path = r.filePaths[0];
  remember(path); app.addRecentDocument(path);
  return { path, name: basename(path), text: await readFile(path, 'utf8') };
});

/* The system menu bar. The classic interface sends its menu model (the same one its browser menu bar draws) once it loads;
   until then, and for the preview interface, a short default menu stands in. An item is [label, act, shortcut], '-' or { role }. */
type MenuModel = [string, (string | [string, string, string?] | { role: string })[]][];
const isModel = (m: unknown): m is MenuModel => Array.isArray(m) && m.every(g => Array.isArray(g) && typeof g[0] === 'string' && Array.isArray(g[1]));
const DEFAULT_MENU: MenuModel = [
  ['File', [['New borehole', 'new', 'Mod+N'], ['Open…', 'open-file', 'Mod+O'], '-', ['Save project', 'save-proj', 'Mod+S'], ['Save project as…', 'save-proj-as', 'Mod+Shift+S']]],
  ['Edit', [['Undo', 'undo', 'Mod+Z'], ['Redo', 'redo', 'Mod+Y'], '-', { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]],
  ['View', [{ role: 'zoom' }, { role: 'dev' }]],
];
function buildMenu(model: MenuModel = DEFAULT_MENU) {
  const send = (act: string) => () => win?.webContents.send('menu', act);
  // Mod is Cmd on a Mac and Ctrl elsewhere; redo is Shift+Cmd+Z on a Mac
  const accel = (act: string, k?: string) => !k || k === 'F1' && isMac ? undefined : act === 'redo' && isMac ? 'Shift+CmdOrCtrl+Z' : k.replace('Mod+', 'CmdOrCtrl+');
  const role = (r: string): MenuItemConstructorOptions[] =>
    r === 'zoom' ? [{ type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    : r === 'dev' ? [{ type: 'separator' }, { label: 'Classic interface', click: () => { win?.close(); createWindow('classic'); } }, { label: 'New interface (preview)', click: () => { win?.close(); createWindow('preview'); } }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]
    : [{ role: r as MenuItemConstructorOptions['role'] }];
  const template: MenuItemConstructorOptions[] = [...(isMac ? [{ role: 'appMenu' as const }] : [])];
  for (const [name, items] of model) {
    const sub: MenuItemConstructorOptions[] = [];
    for (const it of items) {
      if (it === '-') sub.push({ type: 'separator' });
      else if (Array.isArray(it)) { sub.push({ label: it[0], accelerator: accel(it[1], it[2]), click: send(it[1]) }); if (name === 'File' && it[1] === 'open-file') sub.push({ role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] }); }
      else if (it && typeof it === 'object' && typeof it.role === 'string') sub.push(...role(it.role));
    }
    if (name === 'File') sub.push({ type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' });
    // the policy the installer showed, beside the app once installed
    if (name === 'Help') sub.push({ type: 'separator' }, { label: 'Privacy policy', click: () => shell.openPath(app.isPackaged ? join(process.resourcesPath, 'privacy-policy.txt') : join(app.getAppPath(), 'build/privacy-policy.txt')) });
    template.push({ label: name, submenu: sub, ...(name === 'Help' ? { role: 'help' as const } : {}) });
    if (name === 'Reports' || (name === 'View' && !model.some(g => g[0] === 'Reports'))) template.push({ role: 'windowMenu' });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
ipcMain.on('menu:set', (e, model: unknown) => { if (e.sender === win?.webContents && isModel(model)) buildMenu(model); });

/* any page the app ever opens: no embedded web views, and new windows go to the person's browser (web links only) */
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', ev => ev.preventDefault());
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
});

/* one copy of the app: a second launch (double-clicking another project) opens the file in the running window */
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => { const f = argv.find(a => PROJECT_EXT.some(x => a.toLowerCase().endsWith('.' + x))); if (f) sendFile(f); win?.isMinimized() && win.restore(); win?.focus(); });
  app.on('open-file', (e, path) => { e.preventDefault(); sendFile(path); });   // macOS: double-click or drop on the Dock icon
  app.whenReady().then(() => {
    // the window asks for nothing beyond copying to the clipboard and full screen: camera, microphone, location, notifications… are refused
    const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
    buildMenu();
    createWindow(process.env.BOREHOLE_VIEW === 'preview' ? 'preview' : 'classic');
    const f = process.argv.slice(1).find(a => PROJECT_EXT.some(x => a.toLowerCase().endsWith('.' + x))); if (f) sendFile(f);
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
