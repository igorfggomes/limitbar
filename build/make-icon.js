// Gera build/icon.ico (16-256 px) a partir de icon.html. Uso: electron build/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 64, 128, 256];
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, useContentSize: true, show: false, frame: false, transparent: true,
    enableLargerThanScreen: true, webPreferences: { backgroundThrottling: false } });
  win.setContentSize(256, 256);
  await win.loadFile(path.join(__dirname, 'icon.html'));
  await new Promise((r) => setTimeout(r, 300));
  const big = await win.webContents.capturePage();
  const pngs = SIZES.map((s) => (s === 256 ? big : big.resize({ width: s, height: s, quality: 'best' })).toPNG());
  win.destroy();
  // ICO com imagens PNG embutidas
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(SIZES.length, 4);
  let offset = 6 + 16 * SIZES.length;
  const entries = SIZES.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12); offset += pngs[i].length;
    return e;
  });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([head, ...entries, ...pngs]));
  fs.writeFileSync(path.join(__dirname, 'icon.png'), pngs[pngs.length - 1]);
  app.quit();
});
