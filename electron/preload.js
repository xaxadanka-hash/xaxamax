const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
});
