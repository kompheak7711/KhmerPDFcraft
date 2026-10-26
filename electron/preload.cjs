// Exposes a tiny, explicit bridge to the page; nothing else from Node reaches the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('khmerpdfcraft', {
  platform: process.platform,
  ready: () => ipcRenderer.invoke('renderer-ready'),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  savePdf: (name, bytes) => ipcRenderer.invoke('save-pdf', { name, bytes }),
  onOpenFile: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('open-file', listener);
    return () => ipcRenderer.removeListener('open-file', listener);
  },
  onRequestSave: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('request-save', listener);
    return () => ipcRenderer.removeListener('request-save', listener);
  },
});
