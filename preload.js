const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  analyzeFile: (filePath) => ipcRenderer.invoke('analyze-file', filePath),
  hashFile: (filePath) => ipcRenderer.invoke('hash-file', filePath),
  processMorseFrame: (data) => ipcRenderer.invoke('process-morse-frame', data)
});
