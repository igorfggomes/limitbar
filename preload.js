const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onData: (cb) => ipcRenderer.on('data', (_e, d) => cb(d)),
  onHover: (cb) => ipcRenderer.on('hover', (_e, v) => cb(v)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  refresh: () => ipcRenderer.send('refresh'),
  closePanel: () => ipcRenderer.send('close-panel'),
  setCloseToTray: (v) => ipcRenderer.send('set-close-to-tray', v),
  setAutoUpdate: (v) => ipcRenderer.send('set-auto-update', v),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, u) => cb(u)),
  updateInstall: () => ipcRenderer.send('update-install'),
  updateDismiss: () => ipcRenderer.send('update-dismiss'),
  updateCheck: () => ipcRenderer.send('update-check'),
  toggleMain: () => ipcRenderer.send('toggle-main'),
  dockMenu: () => ipcRenderer.send('dock-menu'),
  dockResize: (w) => ipcRenderer.send('dock-resize', w),
  resize: (h) => ipcRenderer.send('resize', h),
});
