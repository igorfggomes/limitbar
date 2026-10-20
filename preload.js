const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onData: (cb) => ipcRenderer.on('data', (_e, d) => cb(d)),
  onHover: (cb) => ipcRenderer.on('hover', (_e, v) => cb(v)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  refresh: () => ipcRenderer.send('refresh'),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
  toggleMain: () => ipcRenderer.send('toggle-main'),
  dockMenu: () => ipcRenderer.send('dock-menu'),
  dockResize: (w) => ipcRenderer.send('dock-resize', w),
  toggleCompact: () => ipcRenderer.send('toggle-compact'),
  resize: (h) => ipcRenderer.send('resize', h),
});
