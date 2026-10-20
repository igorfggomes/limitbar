// Teste de interface da faixa na barra de tarefas (dock.html), no mesmo estilo do ui-smoke.js.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('path');

app.disableHardwareAcceleration();
const H = 3600e3;
// +30 s: o reset cai no MEIO de um minuto, então "reseta em ..." não oscila entre dois textos por milissegundos
const win = (label, percent, h = 3) => ({ label, percent, resetsAt: Date.now() + h * H + 30e3, windowMs: 5 * H });
const data = (c5, cw, x5 = 10, xw = 20) => ({
  claude: { ok: true, windows: [win('5 horas', c5), win('Semanal', cw, 60)] },
  codex: { ok: true, windows: [win('5 horas', x5), win('Semanal', xw, 90)] },
});

let failures = 0;
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['OK   ', name]); } catch (e) { failures++; results.push(['FALHA', `${name}\n         ${String(e.message).split('\n').slice(0, 4).join(' | ')}`]); }
}

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 500, height: 40, webPreferences: {
    preload: path.join(__dirname, 'ui-preload.js'), contextIsolation: false, backgroundThrottling: false } });
  await w.loadFile(path.join(__dirname, '..', 'dock.html'));
  const js = (code) => w.webContents.executeJavaScript(code);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const push = async (d) => { await js(`window.__push.data(${JSON.stringify(d)})`); await wait(60); };
  const calls = () => js('window.__calls.map((c) => c[0])');

  await check('cada número tem rótulo: 5h e sem (semanal), para os dois serviços', async () => {
    await push(data(44, 61));
    assert.deepEqual(await js("[...document.querySelectorAll('.w em')].map((e) => e.textContent)"), ['5h', 'sem', '5h', 'sem']);
    assert.deepEqual(await js("[...document.querySelectorAll('.n')].map((e) => e.textContent)"), ['44%', '61%', '10%', '20%']);
  });

  await check('abaixo de 70%: sem cor de alerta e a faixa fica neutra', async () => {
    assert.equal(await js("document.getElementById('bar').className"), '');
    assert.equal(await js("document.querySelectorAll('.n.warn, .n.bad').length"), 0);
  });

  await check('a partir de 70%: o número e a borda da faixa ficam âmbar', async () => {
    await push(data(75, 61));
    assert.equal(await js("document.getElementById('bar').className"), 'warn');
    assert.equal(await js("document.querySelector('.n.warn').textContent"), '75%');
  });

  await check('a partir de 90%: ⚠ junto do número (não depende de cor) e borda vermelha', async () => {
    await push(data(95, 61));
    assert.equal(await js("document.getElementById('bar').className"), 'bad');
    assert.equal(await js("document.querySelector('.n.bad').textContent"), '⚠ 95%');
  });

  await check('o estado da faixa acompanha a PIOR janela de qualquer serviço', async () => {
    await push(data(10, 10, 10, 92)); // só o Codex semanal está crítico
    assert.equal(await js("document.getElementById('bar').className"), 'bad');
    await push(data(10, 10, 10, 10));
    assert.equal(await js("document.getElementById('bar').className"), '');
  });

  await check('tooltip de cada número traz serviço, janela, percentual e quando reseta', async () => {
    await push(data(44, 61));
    const tips = await js("[...document.querySelectorAll('.w[title]')].map((e) => e.title)");
    assert.match(tips[0], /^Claude · 5 horas: 44% — reseta em \d+h \d+min$/);
    assert.match(tips[1], /^Claude · Semanal: 61% — reseta em 2d /);
  });

  await check('erro com aspas no texto não quebra o tooltip (o atributo vem com escape)', async () => {
    const msg = 'Codex CLI não encontrado. Instale-o e rode "codex" para entrar na sua conta.';
    await push({ ...data(44, 61), codex: { ok: false, error: msg } });
    assert.equal(await js("document.querySelectorAll('.pill')[1].title"), 'Codex: ' + msg);
    assert.equal(await js("document.querySelectorAll('.pill')[1].textContent.trim()"), '⚠');
  });

  await check('texto de erro com HTML não vira marcação (nada é injetado na faixa)', async () => {
    await push({ ...data(44, 61), claude: { ok: false, error: '"><img src=x onerror=alert(1)>' } });
    assert.equal(await js("document.querySelectorAll('#v img').length"), 0);
    assert.equal(await js("document.querySelectorAll('#v svg').length"), 2, 'só os dois logos');
  });

  await check('só redimensiona a janela quando o conteúdo muda (evita piscar)', async () => {
    // o MESMO objeto nas duas leituras: com horários fixos, o texto dos tooltips não muda quando o minuto vira
    const same = data(44, 61);
    await push(same);
    await js('window.__calls.length = 0');
    await push(same);
    const extra = await js('window.__calls.filter((c) => c[0] === "dockResize")');
    assert.equal(extra.length, 0, `leitura idêntica não mexe na janela; chamadas: ${JSON.stringify(extra)} | html: ${(await js("document.getElementById('v').innerHTML")).replace(/<svg.*?<\/svg>/g, '').slice(0, 260)}`);
    await push(data(45, 61));
    assert.ok((await calls()).includes('dockResize'));
  });

  await check('clique na faixa abre o painel e o botão direito abre o menu', async () => {
    await js('window.__calls.length = 0');
    await js("document.getElementById('v').click()");
    await js("document.getElementById('bar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))");
    assert.deepEqual(await calls(), ['toggleMain', 'dockMenu']);
  });

  await check('o aviso ⬆ de atualização aparece e some', async () => {
    await js("window.__push.update({ state: 'available', version: '9.9.9' })");
    assert.notEqual(await js("document.getElementById('up').style.display"), 'none');
    await js("window.__push.update({ state: 'none' })");
    assert.equal(await js("document.getElementById('up').style.display"), 'none');
  });

  console.log('\nTESTE DA FAIXA');
  for (const [s, n] of results) console.log(`  ${s} ${n}`);
  console.log(failures ? `\n${failures} falha(s)` : `\nTodas as ${results.length} verificações passaram`);
  app.exit(failures ? 1 : 0);
});
