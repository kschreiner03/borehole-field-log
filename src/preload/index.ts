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
  // MODFLOW 6, run on this computer: model files in, listed outputs (bytes) back
  mf6Run: (o: { files: Record<string, string>; outputs?: string[] }): Promise<{ ok: boolean; error?: string; stdout?: string; seconds?: number; files?: Record<string, Uint8Array> }> => ipcRenderer.invoke('mf6:run', o),
  // updates: whether GitHub has a newer release (nothing about the user is sent), and the download page in the browser
  updates: {
    check: (): Promise<{ ok: boolean; newer?: boolean; none?: boolean; version?: string; current?: string; notes?: string; date?: string; error?: string }> => ipcRenderer.invoke('update:check'),
    open: (): Promise<void> => ipcRenderer.invoke('update:open'),
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
