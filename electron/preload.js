const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  getDesktopSources: () => ipcRenderer.invoke('desktop-sources:list'),
  showNotification: (payload) => ipcRenderer.send('desktop-notification:show', payload),
  focusWindow: () => ipcRenderer.send('window:focus'),
});
