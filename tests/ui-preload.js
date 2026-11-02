// Substitui o preload real no teste de interface: window.api falso que só registra as chamadas.
// (contextIsolation desligado no teste, então a página enxerga window.__calls e window.__push.)
window.__calls = [];
window.__push = {};
const rec = (name) => (...args) => { window.__calls.push([name, ...args]); };
window.api = {
  onData: (cb) => { window.__push.data = cb; },
  onSettings: (cb) => { window.__push.settings = cb; },
  onUpdate: (cb) => { window.__push.update = cb; },
  onHover: (cb) => { window.__push.hover = cb; },
  refresh: rec('refresh'), closePanel: rec('closePanel'), hidePanel: rec('hidePanel'), resize: rec('resize'),
  setCloseToTray: rec('setCloseToTray'), setAutoUpdate: rec('setAutoUpdate'), setAlerts: rec('setAlerts'),
  setKeepAlive: rec('setKeepAlive'), setSignals: rec('setSignals'), keepAliveTest: rec('keepAliveTest'), setAutoRefreshToken: rec('setAutoRefreshToken'),
  setAutostart: rec('setAutostart'), setTheme: rec('setTheme'), onboardDone: rec('onboardDone'),
  toggleMain: rec('toggleMain'), dockMenu: rec('dockMenu'), dockResize: rec('dockResize'), // usadas só pela faixa
  updateInstall: rec('updateInstall'), updateDismiss: rec('updateDismiss'), updateCheck: rec('updateCheck'),
};
