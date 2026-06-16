const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  analyzeFile: (filePath) => ipcRenderer.invoke('analyze-file', filePath),
  hashFile: (filePath) => ipcRenderer.invoke('hash-file', filePath),
  processMorseFrame: (data) => ipcRenderer.invoke('process-morse-frame', data),
  scanSteganography: (filePath) => ipcRenderer.invoke('scan-steganography', filePath),
  // Executes OutGuess steganography extraction using the WSL-bridge backend
  runOutguess: (filePath, stegoKey) => ipcRenderer.invoke('run-outguess', filePath, stegoKey),
  // Extracts raw text from a PDF file
  extractPdfText: (filePath) => ipcRenderer.invoke('extract-pdf-text', filePath)
});
