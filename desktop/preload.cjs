const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nanaDesktop', {
  save: (name, bytes) => ipcRenderer.invoke('save-copy', name, bytes),
  openAdvanced: () => ipcRenderer.invoke('open-advanced'),
  onProgress: handler => ipcRenderer.on('advanced-progress', (_, text) => handler(text)),
  onOpen: handler => ipcRenderer.on('open-file', (_, name, bytes) => handler(name, bytes)),
  ready: () => ipcRenderer.send('editor-ready'),
});
