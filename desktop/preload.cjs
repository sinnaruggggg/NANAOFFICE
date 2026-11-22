const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('nanaDesktop', {
  save: (name, bytes) => ipcRenderer.invoke('save-copy', name, bytes),
  pickFile: type => ipcRenderer.invoke('pick-local-file', type),
  launchOffice: format => ipcRenderer.invoke('launch-office',format),
  openDroppedOffice: file => ipcRenderer.invoke('open-dropped-office',webUtils.getPathForFile(file)),
  onOfficeResult: handler => ipcRenderer.on('office-result',(_,result) => handler(result)),
  onProgress: handler => ipcRenderer.on('advanced-progress', (_, text) => handler(text)),
  onOpen: handler => ipcRenderer.on('open-file', (_, name, bytes) => handler(name, bytes)),
  ready: () => ipcRenderer.send('editor-ready'),
});
