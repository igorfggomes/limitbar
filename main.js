const { app, BrowserWindow, Menu, Notification, dialog, shell, systemPreferences, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const providers = require('./providers');
const updater = require('./updater');
const alertsLib = require('./lib/alerts');
const keepAliveLib = require('./lib/keepalive');
const cli = require('./lib/cli');

const REFRESH_MS = 60 * 1000;
const WIDTH = 340;
const DOCK_H = 36;
const DOCK_DEFAULT_OFFSET = 340; // distância da borda direita da tela (área da bandeja/relógio)
const FLYOUT_MARGIN = 8;

let win, dock, last = null, hover = true, blurHiddenAt = 0;
let settings = {
  dockX: null, pinned: false, autoUpdate: true, skipVersion: null, closeToTray: true,
  autoRefreshToken: true, onboarded: false, alerts: alertsLib.normalizeConfig({}), keepAlive: keepAliveLib.normalizeConfig({}),
};
let update = { state: 'none' }, updateInfo = null, lastCheckAt = null;
const timers = [];
const alerts = alertsLib.create();
let keepAlive = null, testingKeepAlive = false, modalOpen = false;

const alive = (o) => !!o && !o.isDestroyed();
const file = (n) => path.join(app.getPath('userData'), n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const writeJson = (n, v) => { try { fs.writeFileSync(file(n), JSON.stringify(v)); } catch { /* ignora */ } };
const saveSettings = () => writeJson('window.json', settings);

app.setAppUserModelId('LimitBar'); // nome nas notificações do Windows

if (process.env.LIMITBAR_USER_DATA) app.setPath('userData', process.env.LIMITBAR_USER_DATA); // só para testes

if (!app.requestSingleInstanceLock()) app.quit();

function accent() {
  try { return '#' + systemPreferences.getAccentColor().slice(0, 6); } catch { return '#d97757'; }
}

async function refresh() {
  let claude, codex;
  if (process.env.LIMITBAR_FAKE_DATA) { // só para capturas de tela e testes manuais
    try { ({ claude, codex } = JSON.parse(fs.readFileSync(process.env.LIMITBAR_FAKE_DATA, 'utf8'))); } catch { /* usa os dados reais */ }
  }
  if (!claude) [claude, codex] = await Promise.all([providers.claude(), providers.codex()]);
  last = { claude, codex, updatedAt: Date.now(), accent: accent() };
  for (const [key, name, reading] of [['claude', 'Claude', claude], ['codex', 'Codex', codex]]) {
    alerts.evaluate(key, name, reading, settings.alerts).forEach((n) => new Notification({ title: n.title, body: n.body }).show());
  }
  [win, dock].forEach((w) => alive(w) && w.webContents.send('data', last));
  // janela de 5h parada? (não roda com dados simulados: lá os dados não são de verdade)
  if (keepAlive && !process.env.LIMITBAR_FAKE_DATA) {
    keepAlive.tick({ claude, codex }, settings.keepAlive).catch(() => { /* já registrado na tentativa */ }).finally(sendSettings);
  }
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
  dock.webContents.on('did-finish-load', () => { dock.webContents.send('update', update); if (last) dock.webContents.send('data', last); });
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

// altura máxima do painel: a área útil da tela menos as margens (em telas baixas, as configurações rolam)
function maxPanelHeight() {
  if (process.env.LIMITBAR_FAKE_MAXH) return Number(process.env.LIMITBAR_FAKE_MAXH); // só para testar telas baixas
  return screen.getPrimaryDisplay().workArea.height - 2 * FLYOUT_MARGIN;
}

function sendSettings() {
  if (!alive(win)) return;
  win.webContents.send('settings', {
    closeToTray: settings.closeToTray, autoUpdate: settings.autoUpdate, autoRefreshToken: settings.autoRefreshToken,
    alerts: settings.alerts, onboarded: !!settings.onboarded, openAtLogin: app.getLoginItemSettings().openAtLogin,
    keepAlive: { cfg: settings.keepAlive, status: keepAlive ? keepAlive.status() : null, testing: testingKeepAlive },
    lastCheck: lastCheckAt, version: app.getVersion(), maxHeight: maxPanelHeight(),
  });
}

function setAlerts(patch) {
  const before = settings.alerts;
  settings.alerts = alertsLib.normalizeConfig({ ...before, ...patch, services: { ...before.services, ...((patch && patch.services) || {}) } });
  // mudar os níveis ou ligar/desligar não pode disparar aviso do que já estava acima
  if (JSON.stringify(before.levels) !== JSON.stringify(settings.alerts.levels) || before.enabled !== settings.alerts.enabled) alerts.reseed();
  saveSettings(); sendSettings();
}

function setKeepAlive(patch) {
  const before = settings.keepAlive;
  settings.keepAlive = keepAliveLib.normalizeConfig({ ...before, ...patch, services: { ...before.services, ...((patch && patch.services) || {}) } });
  // religar (ou subir o teto) é pedir para tentar de novo um serviço que o teto tinha desligado
  if (keepAlive) {
    for (const svc of keepAliveLib.SERVICES) {
      const turnedOn = (settings.keepAlive.enabled && !before.enabled) || (settings.keepAlive.services[svc] && !before.services[svc])
        || settings.keepAlive.ceilingPct > before.ceilingPct;
      if (turnedOn) keepAlive.clearDisabled(svc);
    }
  }
  saveSettings(); sendSettings();
}

// "Testar agora": confirma antes (gasta limite de verdade) e mostra o custo medido nas configurações
async function testKeepAlive() {
  if (!keepAlive || testingKeepAlive || keepAlive.status().running) return;
  const svcs = keepAliveLib.SERVICES.filter((s) => settings.keepAlive.services[s]);
  if (!svcs.length) return;
  const names = svcs.map((s) => (s === 'claude' ? 'Claude' : 'Codex')).join(' e ');
  modalOpen = true; // o painel fecha ao perder o foco; com o diálogo aberto, ele precisa ficar
  let res;
  try {
    res = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Testar', 'Cancelar'], defaultId: 1, cancelId: 1, title: 'Testar janela automática',
      message: `Enviar uma mensagem mínima ao ${names}?`,
      detail: 'Isso gasta um pouco do seu limite (em geral menos de 1%). O resultado e o custo medido aparecem nas configurações.',
    });
  } finally { modalOpen = false; }
  if (res.response !== 0) return;
  testingKeepAlive = true; sendSettings();
  try { await keepAlive.testNow(svcs, last || {}, settings.keepAlive); } finally { testingKeepAlive = false; sendSettings(); }
}

function setAutoRefreshToken(v) {
  settings.autoRefreshToken = !!v;
  providers.configure({ autoRefresh: settings.autoRefreshToken });
  saveSettings(); sendSettings();
}

function setAutostart(v) {
  app.setLoginItemSettings({ openAtLogin: !!v });
  sendSettings();
}

function finishOnboarding(opts) {
  if (opts && opts.autostart) app.setLoginItemSettings({ openAtLogin: true });
  settings.onboarded = true;
  saveSettings(); sendSettings();
}

function setAutoUpdate(v) {
  settings.autoUpdate = !!v; saveSettings();
  sendSettings();
}

function setCloseToTray(v) {
  settings.closeToTray = !!v; saveSettings();
  sendSettings();
}

// ---------- atualização automática ----------
const UPDATE_CHECK_MS = 6 * 3600e3;
function setUpdate(next) {
  update = next;
  [win, dock].forEach((w) => alive(w) && w.webContents.send('update', update));
}

async function checkUpdates(manual = false) {
  if (update.state === 'downloading' || update.state === 'installing') return;
  if (manual) setUpdate({ state: 'checking' });
  try {
    const info = await updater.check();
    lastCheckAt = Date.now(); sendSettings();
    if (!info) {
      if (manual) {
        setUpdate({ state: 'uptodate' });
        setTimeout(() => update.state === 'uptodate' && setUpdate({ state: 'none' }), 6000);
      }
      return;
    }
    if (!manual && settings.skipVersion === info.version) return; // você dispensou esta versão
    updateInfo = info;
    const novo = update.version !== info.version;
    setUpdate({ state: 'available', version: info.version, canInstall: updater.canSelfUpdate() && !!info.assetUrl });
    if (novo) new Notification({ title: `LimitBar ${info.version} disponível`, body: 'Abra o painel para atualizar com um clique.' }).show();
    if (process.env.LIMITBAR_AUTO_APPLY) installUpdate(); // só para testes
  } catch (e) {
    if (manual) setUpdate({ state: 'error', message: 'Não foi possível verificar: ' + e.message });
  }
}

async function installUpdate() {
  if (!updateInfo || update.state === 'downloading' || update.state === 'installing') return;
  const base = { version: updateInfo.version, canInstall: true };
  if (!(updater.canSelfUpdate() && updateInfo.assetUrl)) { shell.openExternal(updateInfo.page); return; } // sem permissão: abre a página
  try {
    let pct = -1;
    setUpdate({ ...base, state: 'downloading', progress: 0 });
    const zip = await updater.download(updateInfo, (p) => {
      if (Math.round(p * 100) !== pct) { pct = Math.round(p * 100); setUpdate({ ...base, state: 'downloading', progress: p }); }
    });
    setUpdate({ ...base, state: 'installing' });
    updater.apply(zip);
    setTimeout(() => app.quit(), 800); // o script espera o app fechar, troca os arquivos e reabre
  } catch (e) {
    setUpdate({ ...base, state: 'error', message: e.message });
  }
}

function dismissUpdate() {
  if (update.version) { settings.skipVersion = update.version; saveSettings(); }
  setUpdate({ state: 'none' });
}

// menu de contexto (clique direito na faixa)
function showMenu() {
  Menu.buildFromTemplate([
    { label: 'Atualizar agora', click: refresh },
    { label: 'Minimizar ao fechar (✕ só esconde o painel)', type: 'checkbox', checked: settings.closeToTray, click: (i) => setCloseToTray(i.checked) },
    { label: 'Manter aberto ao clicar fora', type: 'checkbox', checked: settings.pinned,
      click: (i) => { settings.pinned = i.checked; saveSettings(); } },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => setAutostart(i.checked) },
    { type: 'separator' },
    { label: `LimitBar ${app.getVersion()}`, enabled: false },
    update.state === 'available'
      ? { label: `Atualizar para ${update.version}`, click: installUpdate }
      : { label: 'Procurar atualizações', click: () => checkUpdates(true) },
    { label: 'Verificar atualizações automaticamente', type: 'checkbox', checked: settings.autoUpdate,
      click: (i) => setAutoUpdate(i.checked) },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]).popup({ window: dock });
}

app.whenReady().then(() => {
  const stored = readJson('window.json', null);
  settings = { ...settings, ...(stored || {}) };
  settings.alerts = alertsLib.normalizeConfig(settings.alerts);
  settings.keepAlive = keepAliveLib.normalizeConfig(settings.keepAlive);
  keepAlive = keepAliveLib.createKeepAlive({
    runCommand: (svc) => cli.run(svc),
    readFresh: (svc) => (svc === 'claude' ? providers.claude({ force: true }) : providers.codex()),
    notify: (n) => new Notification({ title: n.title, body: n.body }).show(),
    store: { load: () => readJson('keepalive.json', { attempts: [], disabled: {} }), save: (s) => writeJson('keepalive.json', s) },
  });
  // quem já usava o app antes das boas-vindas existirem não precisa vê-las
  if (stored && stored.onboarded === undefined) settings.onboarded = true;
  providers.configure({ autoRefresh: settings.autoRefreshToken !== false });
  try { fs.unlinkSync(file('history.json')); } catch { /* arquivo de uma versão antiga; não é mais usado */ }

  win = new BrowserWindow({
    width: WIDTH, height: 360, show: false,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundMaterial: 'acrylic', backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    sendSettings();
    win.webContents.send('update', update);
    if (last) win.webContents.send('data', last);
    if (!settings.onboarded) setTimeout(openFlyout, 600); // primeira abertura: mostra as boas-vindas
  });
  // perdeu o foco (clique fora) -> fecha como um flyout, a menos que esteja fixado
  win.on('blur', () => {
    if (settings.pinned || modalOpen || !win.isVisible()) return;
    blurHiddenAt = Date.now();
    win.hide();
  });

  createDock();

  ipcMain.on('refresh', refresh);
  // ✕ do painel: esconde (a faixa continua rodando) ou encerra o app, conforme a configuração
  ipcMain.on('close-panel', () => { if (settings.closeToTray) win.hide(); else app.quit(); });
  ipcMain.on('set-close-to-tray', (_e, v) => setCloseToTray(v));
  ipcMain.on('set-auto-update', (_e, v) => setAutoUpdate(v));
  ipcMain.on('set-alerts', (_e, patch) => setAlerts(patch && typeof patch === 'object' ? patch : {}));
  ipcMain.on('set-keepalive', (_e, patch) => setKeepAlive(patch && typeof patch === 'object' ? patch : {}));
  ipcMain.on('keepalive-test', () => { testKeepAlive().catch(() => { modalOpen = false; testingKeepAlive = false; }); });
  ipcMain.on('set-auto-refresh-token', (_e, v) => setAutoRefreshToken(v));
  ipcMain.on('set-autostart', (_e, v) => setAutostart(v));
  ipcMain.on('onboard-done', (_e, opts) => finishOnboarding(opts));
  ipcMain.on('toggle-main', toggle);
  ipcMain.on('dock-menu', showMenu);
  ipcMain.on('update-install', installUpdate);
  ipcMain.on('update-dismiss', dismissUpdate);
  ipcMain.on('update-check', () => checkUpdates(true));
  ipcMain.on('resize', (_e, h) => {
    if (!alive(win)) return;
    // janelas não redimensionáveis ignoram pedidos para encolher no Windows: libera só durante a troca
    win.setResizable(true);
    win.setSize(WIDTH, Math.min(Math.ceil(h), maxPanelHeight()));
    win.setResizable(false);
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
      // o acrílico do Windows não aparece em capturas: usa um fundo escuro equivalente
      await win.webContents.executeJavaScript("document.documentElement.style.background='#1f2026'; document.body.classList.remove('idle')");
      if (process.env.WIDGET_OPEN_SETTINGS) await win.webContents.executeJavaScript("document.getElementById('g').click()");
      if (process.env.WIDGET_OPEN_SECTIONS) { // "all" ou índices (1,3) das seções a expandir
        await win.webContents.executeJavaScript(`(() => { const want = ${JSON.stringify(process.env.WIDGET_OPEN_SECTIONS)}; document.querySelectorAll('details.ps').forEach((d, i) => { d.open = want === 'all' || want.split(',').map(Number).includes(i + 1); }); })()`);
      }
      await new Promise((r) => setTimeout(r, process.env.WIDGET_OPEN_SETTINGS ? 1500 : 500)); // espera o quadro novo ser pintado
      fs.writeFileSync(process.env.WIDGET_SHOT, (await win.webContents.capturePage()).toPNG());
      fs.writeFileSync(process.env.WIDGET_SHOT + '.dock.png', (await dock.webContents.capturePage()).toPNG());
      fs.writeFileSync(process.env.WIDGET_SHOT + '.pos.txt', JSON.stringify({
        win: win.getBounds(), dock: dock.getBounds(), wa: screen.getPrimaryDisplay().workArea,
        card: await win.webContents.executeJavaScript("[document.getElementById('card').offsetHeight, document.body.className, innerHeight, 'erro=' + !!document.querySelector('.errcard')].join(' ')"),
        taskbarButton: false,
      }));
      app.quit();
    }, 5000);
  }

  refresh();
  timers.push(setInterval(refresh, REFRESH_MS));
  watchHover();
  watchTaskbar();
  // verifica logo depois de abrir e a cada 6 horas (se não estiver desligado)
  setTimeout(() => settings.autoUpdate && checkUpdates(), process.env.LIMITBAR_UPDATE_URL ? 3000 : 20000);
  timers.push(setInterval(() => settings.autoUpdate && checkUpdates(), UPDATE_CHECK_MS));
});

app.on('second-instance', () => { if (alive(win)) openFlyout(); });

// ao sair, para todos os timers antes de as janelas serem destruídas
app.on('before-quit', () => timers.forEach(clearInterval));

app.on('window-all-closed', (e) => e.preventDefault());
