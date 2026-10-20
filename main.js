const { app, BrowserWindow, Menu, Notification, systemPreferences, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const providers = require('./providers');

const REFRESH_MS = 60 * 1000;
const HISTORY_KEEP_MS = 7 * 86400e3;
const HISTORY_STEP_MS = 5 * 60e3;
const WIDTH = 340;
const ALERT_LEVELS = [80, 95];
const DOCK_H = 36;
const DOCK_DEFAULT_OFFSET = 340; // distância da borda direita da tela (área da bandeja/relógio)
const FLYOUT_MARGIN = 8;

let win, dock, last = null, history = [], hover = true, blurHiddenAt = 0;
let settings = { compact: false, dockX: null, pinned: false };
const timers = [];
const alerted = {}; // "serviço/janela" -> maior nível já avisado nesta janela

const alive = (o) => !!o && !o.isDestroyed();
const file = (n) => path.join(app.getPath('userData'), n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const writeJson = (n, v) => { try { fs.writeFileSync(file(n), JSON.stringify(v)); } catch { /* ignora */ } };
const saveSettings = () => writeJson('window.json', settings);

app.setAppUserModelId('LimitBar'); // nome nas notificações do Windows

if (!app.requestSingleInstanceLock()) app.quit();

// ---------- histórico (alimenta os sparklines) ----------
function recordHistory(claude, codex) {
  const pick = (p) => (p.ok ? p.windows.map((w) => w.percent) : [null, null]);
  const entry = { t: Date.now(), claude: pick(claude), codex: pick(codex) };
  const prev = history[history.length - 1];
  const same = prev && JSON.stringify(prev.claude) === JSON.stringify(entry.claude) && JSON.stringify(prev.codex) === JSON.stringify(entry.codex);
  if (!prev || !same || entry.t - prev.t >= HISTORY_STEP_MS) history.push(entry);
  const cutoff = Date.now() - HISTORY_KEEP_MS;
  history = history.filter((e) => e.t >= cutoff);
  writeJson('history.json', history);
}

// ---------- alertas de 80% e 95% ----------
function checkAlerts(name, p) {
  if (!p.ok) return;
  p.windows.forEach((w) => {
    const key = `${name}/${w.label}`;
    const level = ALERT_LEVELS.filter((l) => w.percent >= l).pop() || 0;
    if (level > (alerted[key] || 0)) {
      new Notification({ title: `${name} — ${w.label}`, body: `Você usou ${Math.round(w.percent)}% do limite.` }).show();
    }
    alerted[key] = level; // volta a 0 quando a janela reseta, então o aviso vale de novo
  });
}

function accent() {
  try { return '#' + systemPreferences.getAccentColor().slice(0, 6); } catch { return '#d97757'; }
}

async function refresh() {
  const [claude, codex] = await Promise.all([providers.claude(), providers.codex()]);
  recordHistory(claude, codex);
  last = { claude, codex, updatedAt: Date.now(), history, accent: accent() };
  checkAlerts('Claude', claude);
  checkAlerts('Codex', codex);
  [win, dock].forEach((w) => alive(w) && w.webContents.send('data', last));
}

// ---------- flyout: abre grudado na barra de tarefas, ancorado na faixa ----------
function placeFlyout() {
  if (!alive(win)) return;
  const d = screen.getPrimaryDisplay(), b = d.bounds, wa = d.workArea, M = FLYOUT_MARGIN;
  const { width: w, height: h } = win.getBounds();
  const ab = alive(dock) ? dock.getBounds() : null;
  const ax = ab ? ab.x + ab.width / 2 : wa.x + wa.width - w / 2 - M;
  const ay = ab ? ab.y + ab.height / 2 : wa.y + wa.height - h / 2 - M;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const edge = wa.y > b.y ? 'top' : wa.x > b.x ? 'left' : wa.width < b.width ? 'right' : 'bottom';
  let x = clamp(ax - w / 2, wa.x + M, wa.x + wa.width - w - M);
  let y = wa.y + wa.height - h - M;
  if (edge === 'top') y = wa.y + M;
  if (edge === 'left' || edge === 'right') {
    x = edge === 'left' ? wa.x + M : wa.x + wa.width - w - M;
    y = clamp(ay - h / 2, wa.y + M, wa.y + wa.height - h - M);
  }
  win.setPosition(Math.round(x), Math.round(y));
}

function openFlyout() {
  placeFlyout();
  win.show(); win.focus();
  placeFlyout();
}

// Clicar na faixa com o flyout aberto fecha. Se ele acabou de fechar por perda de foco, não reabre.
function toggle() {
  if (Date.now() - blurHiddenAt < 350) return;
  if (win.isVisible()) win.hide(); else openFlyout();
}

// Regiões arrastáveis não recebem :hover, então detectamos pelo cursor.
function watchHover() {
  timers.push(setInterval(() => {
    if (!alive(win) || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint(), b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (inside !== hover) { hover = inside; win.webContents.send('hover', inside); }
  }, 250));
}

// ---------- faixa sobre a barra de tarefas ----------
function dockBaseY() {
  const d = screen.getPrimaryDisplay(), b = d.bounds, wa = d.workArea;
  if (wa.y > b.y) return b.y + Math.round((wa.y - b.y - DOCK_H) / 2); // barra no topo
  const tb = b.height - wa.height;
  const top = tb > 0 && wa.x === b.x && wa.width === b.width ? wa.y + wa.height : b.y + b.height - 48; // embaixo (ou oculta)
  return top + Math.round(((tb > 0 ? tb : 48) - DOCK_H) / 2);
}

function createDock() {
  const b = screen.getPrimaryDisplay().bounds, w = 190;
  dock = new BrowserWindow({
    width: w, height: DOCK_H, x: settings.dockX ?? b.x + b.width - w - DOCK_DEFAULT_OFFSET, y: dockBaseY(),
    frame: false, transparent: true, resizable: false, thickFrame: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, hasShadow: false, minHeight: DOCK_H, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  dock.setAlwaysOnTop(true, 'screen-saver');
  dock.loadFile('dock.html');
  dock.webContents.on('did-finish-load', () => last && dock.webContents.send('data', last));
  dock.on('moved', () => { // só desliza na horizontal, preso à altura da barra
    const [x] = dock.getPosition();
    dock.setPosition(x, dockBaseY());
    settings.dockX = x; saveSettings();
    if (alive(win) && win.isVisible()) placeFlyout();
  });
}

// A barra do Windows sobe por cima da faixa quando você interage com ela (clique, menu iniciar...).
// Reerguer uma janela que já está no topo não muda nada na tela, então é seguro reerguer sempre:
// a cada 100 ms enquanto o mouse está na barra (e por 2,5 s depois), e a cada 1 s no resto do tempo
// (cobre atalhos de teclado, como a tecla Windows).
function watchTaskbar() {
  let lastIn = 0, lastRaise = 0;
  timers.push(setInterval(() => {
    if (!alive(dock)) return;
    const now = Date.now(), d = screen.getPrimaryDisplay(), p = screen.getCursorScreenPoint();
    const within = (r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
    if (within(d.bounds) && !within(d.workArea)) lastIn = now;
    const every = now - lastIn < 2500 ? 100 : 1000;
    if (now - lastRaise >= every) { dock.moveTop(); lastRaise = now; }
  }, 100));
}

function setCompact(v) {
  settings.compact = v; saveSettings();
  if (alive(win)) win.webContents.send('settings', { compact: v });
}

// menu de contexto (clique direito na faixa)
function showMenu() {
  Menu.buildFromTemplate([
    { label: 'Atualizar agora', click: refresh },
    { label: 'Modo compacto', type: 'checkbox', checked: settings.compact, click: (i) => setCompact(i.checked) },
    { label: 'Manter aberto ao clicar fora', type: 'checkbox', checked: settings.pinned,
      click: (i) => { settings.pinned = i.checked; saveSettings(); } },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]).popup({ window: dock });
}

app.whenReady().then(() => {
  settings = { ...settings, ...readJson('window.json', {}) };
  history = readJson('history.json', []);

  win = new BrowserWindow({
    width: WIDTH, height: 360, show: false,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundMaterial: 'acrylic', backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('settings', { compact: settings.compact });
    if (last) win.webContents.send('data', last);
  });
  // perdeu o foco (clique fora) -> fecha como um flyout, a menos que esteja fixado
  win.on('blur', () => {
    if (settings.pinned || !win.isVisible()) return;
    blurHiddenAt = Date.now();
    win.hide();
  });

  createDock();

  ipcMain.on('refresh', refresh);
  ipcMain.on('hide', () => win.hide());
  ipcMain.on('quit', () => app.quit());
  ipcMain.on('toggle-compact', () => setCompact(!settings.compact));
  ipcMain.on('toggle-main', toggle);
  ipcMain.on('dock-menu', showMenu);
  ipcMain.on('resize', (_e, h) => {
    if (!alive(win)) return;
    win.setSize(WIDTH, Math.ceil(h));
    if (win.isVisible()) placeFlyout(); // a altura mudou: mantém colado na barra
  });
  ipcMain.on('dock-resize', (_e, w) => { // só redimensiona se a largura realmente mudou
    if (alive(dock) && Math.abs(dock.getBounds().width - Math.ceil(w)) > 1) {
      dock.setSize(Math.ceil(w), DOCK_H);
      if (alive(win) && win.isVisible()) placeFlyout();
    }
  });

  if (process.env.WIDGET_SHOT) {
    // modo de depuração: abre o flyout, salva capturas e posições, e fecha
    setTimeout(openFlyout, 3000);
    setTimeout(async () => {
      fs.writeFileSync(process.env.WIDGET_SHOT, (await win.webContents.capturePage()).toPNG());
      fs.writeFileSync(process.env.WIDGET_SHOT + '.dock.png', (await dock.webContents.capturePage()).toPNG());
      fs.writeFileSync(process.env.WIDGET_SHOT + '.pos.txt', JSON.stringify({
        win: win.getBounds(), dock: dock.getBounds(), wa: screen.getPrimaryDisplay().workArea,
        taskbarButton: false,
      }));
      app.quit();
    }, 5000);
  }

  refresh();
  timers.push(setInterval(refresh, REFRESH_MS));
  watchHover();
  watchTaskbar();
});

app.on('second-instance', () => { if (alive(win)) openFlyout(); });

// ao sair, para todos os timers antes de as janelas serem destruídas
app.on('before-quit', () => timers.forEach(clearInterval));

app.on('window-all-closed', (e) => e.preventDefault());
