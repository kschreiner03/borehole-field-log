import { contextBridge, ipcRenderer } from 'electron';

/* The only bridge between the window and the computer: native save/open dialogs and menu commands. */
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
};
contextBridge.exposeInMainWorld('desktop', desktop);
export type Desktop = typeof desktop;
