import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

/* The desktop shell. The current interface ("classic") runs from resources/legacy; the React interface is being
   built alongside it and opens from View > New interface (preview). Project files are ordinary files on disk. */
const isMac = process.platform === 'darwin';
const PROJECT_EXT = ['bhp', 'bhlog', 'json'];
const FILTERS: Record<string, Electron.FileFilter[]> = {
  bhp: [{ name: 'Borehole project', extensions: ['bhp'] }],
  bhlog: [{ name: 'Borehole workspace', extensions: ['bhlog'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  xlsx: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
};
let win: BrowserWindow | null = null;
let rendererReady = false;
const queued: string[] = [];   // project files opened from the OS before the window was ready

function createWindow(view: 'classic' | 'preview' = 'classic') {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1000, minHeight: 640, title: 'Borehole Field Log', show: false,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.mjs'), contextIsolation: true, sandbox: false },
  });
  win.once('ready-to-show', () => win?.show());
  // smoke test: BOREHOLE_SMOKE=<png path> loads the window, saves a screenshot and quits
  if (process.env.BOREHOLE_SMOKE) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    const img = await win!.webContents.capturePage(); await writeFile(process.env.BOREHOLE_SMOKE!, img.toPNG());
    const probe = await win!.webContents.executeJavaScript('JSON.stringify({ desktop: !!window.desktop, title: document.title, err: window.__err || null })');
    console.log('SMOKE', probe); app.quit();
  }, 3500));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
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
  let path = !o.saveAs && o.path ? o.path : null;
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

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Borehole project or workspace', extensions: PROJECT_EXT }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const path = r.filePaths[0];
  app.addRecentDocument(path);
  return { path, name: basename(path), text: await readFile(path, 'utf8') };
});

function buildMenu() {
  const send = (act: string) => () => win?.webContents.send('menu', act);
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      { label: 'New borehole', accelerator: 'CmdOrCtrl+N', click: send('new') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open-file') },
      { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
      { type: 'separator' },
      { label: 'Save project', accelerator: 'CmdOrCtrl+S', click: send('save-proj') },
      { label: 'Save project as…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-proj-as') },
      { label: 'Save workspace (all projects)…', click: send('backup') },
      { type: 'separator' },
      { label: 'Import Excel…', click: send('import') },
      { label: 'Download this log (PDF)', click: send('pdf-one') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Find anything…', accelerator: 'CmdOrCtrl+K', click: send('find') },
      { type: 'separator' },
      { label: 'Classic interface', click: () => { win?.close(); createWindow('classic'); } },
      { label: 'New interface (preview)', click: () => { win?.close(); createWindow('preview'); } },
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
