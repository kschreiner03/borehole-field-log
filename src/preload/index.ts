import { contextBridge, ipcRenderer } from 'electron';

/* The only bridge between the window and the computer: native save/open dialogs, menu commands, MODFLOW, Apple Maps pictures and the update check. */
export interface OpenedFile { path: string; name: string; text: string }
const desktop = {
  platform: process.platform,
  save: (o: { name: string; data: ArrayBuffer; path?: string | null; saveAs?: boolean }): Promise<{ path: string; name: string } | null> => ipcRenderer.invoke('file:save', o),
  open: (): Promise<OpenedFile | null> => ipcRenderer.invoke('file:open'),
  // the page's menu model: [name, items][]; an item is [label, act, shortcut], '-' or { role }
  setMenu: (model: unknown) => ipcRenderer.send('menu:set', model),
  onMenu: (cb: (act: string) => void) => { ipcRenderer.on('menu', (_e, act: string) => cb(act)); },
  onOpenFile: (cb: (f: OpenedFile) => void) => { ipcRenderer.on('open-file', (_e, f: OpenedFile) => cb(f)); },
  ready: () => ipcRenderer.send('renderer-ready'),
  // a page in a window of its own; and which page such a window is on, kept for the next start
  openWindow: (o: { tab: string; pane: string; p: string; b: string }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('win:open', o),
  winState: (o: { tab: string; p: string }) => ipcRenderer.send('win:state', o),
  // a vector PDF of page drawings (SVG, sizes in inches), printed by the shell so text stays text
  svgPdf: (o: { pages: { svg: string; w: number; h: number }[] }): Promise<{ ok: boolean; data?: Uint8Array; error?: string }> => ipcRenderer.invoke('pdf:svg', o),
  // MODFLOW 6, run on this computer: model files in, listed outputs (bytes) back
  mf6Run: (o: { files: Record<string, string>; outputs?: string[] }): Promise<{ ok: boolean; error?: string; stdout?: string; seconds?: number; files?: Record<string, Uint8Array> }> => ipcRenderer.invoke('mf6:run', o),
  // GIS engines (GRASS GIS, GDAL, PyKrige, GSTools), optional and installed per user: one job from a fixed list of methods at a time
  gis: {
    status: (): Promise<{ installed: boolean; supported?: boolean; home?: string; versions?: Record<string, string>; broken?: string } | null> => ipcRenderer.invoke('gis:status'),
    install: (pack?: string): Promise<{ ok: boolean; error?: string; paused?: boolean; cancelled?: boolean; space?: { free: number; need: number } }> => ipcRenderer.invoke('gis:install', pack),
    packs: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('gis:packs'),
    plan: (pack: string): Promise<Record<string, unknown> & { ok: boolean; error?: string }> => ipcRenderer.invoke('gis:plan', pack),
    stop: (how: 'pause' | 'cancel'): Promise<boolean> => ipcRenderer.invoke('gis:stop', how),
    size: (): Promise<{ engines: number } | null> => ipcRenderer.invoke('gis:size'),
    chooseFolder: (): Promise<{ ok: boolean; home?: string; error?: string; cancelled?: boolean }> => ipcRenderer.invoke('gis:folder'),
    remove: (pack?: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('gis:remove', pack),
    run: (job: unknown): Promise<Record<string, unknown> & { ok: boolean; error?: string }> => ipcRenderer.invoke('gis:run', job),
    onProgress: (cb: (p: Record<string, unknown>) => void) => { ipcRenderer.on('gis:progress', (_e, p) => cb(p)); },
    // a running job's progress (the share done and what it is doing), and stopping it
    onJobProgress: (cb: (p: { id: string; p?: number; msg?: string }) => void) => { ipcRenderer.on('gis:jobprogress', (_e, p) => cb(p)); },
    cancel: (id: string): Promise<boolean> => ipcRenderer.invoke('gis:cancel', id),
    // an elevation model chosen in an Open dialog: a token for the file (its name and size to show), never its path
    pick: (what?: 'vector' | 'image' | 'raster' | 'lidar' | 'csv'): Promise<{ token: string; name: string; size: number } | null> => ipcRenderer.invoke('gis:pick', what),
    saveFile: (token: string, name?: string): Promise<{ name: string } | null> => ipcRenderer.invoke('gis:savefile', token, name),
  },
  // updates: whether GitHub has a newer release (nothing about the user is sent), and the download page in the browser
  updates: {
    check: (): Promise<{ ok: boolean; newer?: boolean; none?: boolean; version?: string; current?: string; notes?: string; date?: string; error?: string }> => ipcRenderer.invoke('update:check'),
    open: (): Promise<void> => ipcRenderer.invoke('update:open'),
  },
  // map services: hosts the person allowed, in the shell's own dialog; pictures and descriptions from those only
  web: {
    hosts: (): Promise<string[]> => ipcRenderer.invoke('web:hosts'),
    allow: (u: string): Promise<{ ok: boolean; host?: string; error?: string; cancelled?: boolean }> => ipcRenderer.invoke('web:allow', u),
    forget: (h: string): Promise<string[]> => ipcRenderer.invoke('web:forget', h),
    get: (u: string): Promise<{ ok: boolean; type?: string; data?: string; status?: number; error?: string; host?: string }> => ipcRenderer.invoke('web:get', u),
  },
  // oilfield data kept on this computer: search, download (asked in the shell's dialog), production
  oil: {
    run: (q: unknown): Promise<{ ok: boolean; data?: unknown; error?: string; cancelled?: boolean }> => ipcRenderer.invoke('oil:run', q),
    cancel: (): Promise<boolean> => ipcRenderer.invoke('oil:cancel'),
    clear: (): Promise<boolean> => ipcRenderer.invoke('oil:clear'),
    onProgress: (f: (m: string) => void) => { const h = (_: unknown, m: string) => f(m); ipcRenderer.on('oil:progress', h); return () => ipcRenderer.removeListener('oil:progress', h); },
  },
  // Apple Maps satellite pictures, signed by the shell with the user's Maps key (which never comes to the window)
  appleMaps: {
    status: (): Promise<{ teamId: string; keyId: string } | null> => ipcRenderer.invoke('apple:status'),
    setup: (c: { teamId: string; keyId: string; key: string } | null): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('apple:setup', c),
    snapshot: (q: { lat: number; lon: number; z: number; w: number; h: number; scale?: number }): Promise<{ ok: boolean; data?: string; status?: number; error?: string }> => ipcRenderer.invoke('apple:snapshot', q),
  },
};
contextBridge.exposeInMainWorld('desktop', desktop);
export type Desktop = typeof desktop;
