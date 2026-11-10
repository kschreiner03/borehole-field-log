import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { mf6Binary, runMf6 } from './mf6run.mjs';
import { clearCreds, fetchSnapshot, loadCreds, saveCreds } from './applemaps.mjs';
import { checkForUpdate, HUB } from './updates.mjs';

/* The desktop shell. The current interface ("classic") runs from resources/legacy; the React interface is being
   built alongside it and opens from View > New interface (preview). Project files are ordinary files on disk. */
const isMac = process.platform === 'darwin';
// tests run in their own profile, beside a copy already open
if (process.env.BOREHOLE_USER_DATA) app.setPath('userData', process.env.BOREHOLE_USER_DATA);
const PROJECT_EXT = ['bhp', 'bhlog', 'json'];
const FILTERS: Record<string, Electron.FileFilter[]> = {
  bhp: [{ name: 'Borehole project', extensions: ['bhp'] }],
  bhlog: [{ name: 'Borehole workspace', extensions: ['bhlog'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  xlsx: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
};
let win: BrowserWindow | null = null;
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
  try { win.webContents.send('open-file', { path, name: basename(path), text: await readFile(path, 'utf8') }); app.addRecentDocument(path); }
  catch (e) { dialog.showErrorBox('Could not open the file', `${path}\n\n${(e as Error).message}`); }
}

ipcMain.on('renderer-ready', () => { rendererReady = true; for (const p of queued.splice(0)) sendFile(p); });

/* save: write to the remembered path, or ask where (Save as, or the first save) */
ipcMain.handle('file:save', async (_e, o: { name: string; data: ArrayBuffer; path?: string | null; saveAs?: boolean }) => {
  // writing without asking is only for a linked project file; anything else goes through the dialog
  let path = !o.saveAs && o.path && /\.(bhp|bhlog)$/i.test(o.path) ? o.path : null;
  if (!path) {
    const ext = extname(o.name).slice(1).toLowerCase();
    const r = await dialog.showSaveDialog(win!, { defaultPath: o.name, filters: FILTERS[ext] || [{ name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePath) return null;
    path = r.filePath;
  }
  await writeFile(path, Buffer.from(o.data));
  if (/\.(bhp|bhlog)$/i.test(path)) app.addRecentDocument(path);
  return { path, name: basename(path) };
});

/* MODFLOW 6: the page sends model files (plain names, text only) and gets the listed outputs back; nothing else reaches the shell */
ipcMain.handle('mf6:run', async (e, o: { files: Record<string, string>; outputs?: string[] }) => {
  if (e.sender !== win?.webContents) return { ok: false, error: 'Not allowed.' };
  return runMf6({ bin: mf6Binary(app.getAppPath()), files: o?.files, outputs: Array.isArray(o?.outputs) ? o.outputs : [] });
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

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Borehole project or workspace', extensions: PROJECT_EXT }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const path = r.filePaths[0];
  app.addRecentDocument(path);
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

/* one copy of the app: a second launch (double-clicking another project) opens the file in the running window */
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => { const f = argv.find(a => PROJECT_EXT.some(x => a.toLowerCase().endsWith('.' + x))); if (f) sendFile(f); win?.isMinimized() && win.restore(); win?.focus(); });
  app.on('open-file', (e, path) => { e.preventDefault(); sendFile(path); });   // macOS: double-click or drop on the Dock icon
  app.whenReady().then(() => {
    buildMenu();
    createWindow(process.env.BOREHOLE_VIEW === 'preview' ? 'preview' : 'classic');
    const f = process.argv.slice(1).find(a => PROJECT_EXT.some(x => a.toLowerCase().endsWith('.' + x))); if (f) sendFile(f);
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
