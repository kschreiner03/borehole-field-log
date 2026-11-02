// The desktop bridge for checks that run MODFLOW 6: the model runner, and harmless stand-ins for the rest
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform, save: async () => null, open: async () => null, setMenu: () => {}, onMenu: () => {}, onOpenFile: () => {}, ready: () => {},
  mf6Run: o => ipcRenderer.invoke('mf6:run', o),
});
