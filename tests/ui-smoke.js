// Teste de interface de verdade: carrega o painel num Electron oculto e exercita o comportamento.
//   npm run test:ui        (precisa do Electron instalado; por isso não roda no CI dos testes rápidos)
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('path');

app.disableHardwareAcceleration();

const H = 3600e3;
const settings = {
  closeToTray: true, autoUpdate: true, autoRefreshToken: true, onboarded: true, openAtLogin: false, version: '1.4.1', maxHeight: 900,
  alerts: { enabled: true, levels: [80, 95], onReset: true, services: { claude: true, codex: true } },
  keepAlive: { cfg: { enabled: false, services: { claude: true, codex: true }, ceilingPct: 2 }, status: null, testing: false },
};
const reading = () => ({
  updatedAt: Date.now(), accent: '#0067c0',
  claude: { ok: true, windows: [
    { label: '5 horas', percent: 44, resetsAt: Date.now() + 3 * H, windowMs: 5 * H },
    { label: 'Semanal', percent: 95, resetsAt: Date.now() + 50 * H, windowMs: 168 * H }] },
  codex: { ok: false, code: 'not-installed', error: 'Codex CLI não encontrado. Instale-o e rode "codex" para entrar na sua conta.' },
});

const reading2 = () => ({
  updatedAt: Date.now(), accent: '#0067c0',
  claude: reading().claude,
  codex: { ok: true, windows: [
    { label: '5 horas', percent: 10, resetsAt: Date.now() + 4 * H, windowMs: 5 * H },
    { label: 'Semanal', percent: 20, resetsAt: Date.now() + 90 * H, windowMs: 168 * H }] },
});

let failures = 0;
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['OK   ', name]); } catch (e) { failures++; results.push(['FALHA', `${name}\n         ${String(e.message).split('\n').slice(0, 4).join(' | ')}`]); }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 340, height: 600, webPreferences: {
    preload: path.join(__dirname, 'ui-preload.js'), contextIsolation: false, backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = (k, extra = {}) => js(`document.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, bubbles: true, ...extra })}))`);
  const calls = () => js('window.__calls.map((c) => c[0])');

  await check('antes dos dados: mostra o esqueleto de carregamento e avisa "ocupado" aos leitores de tela', async () => {
    assert.equal(await js("document.querySelectorAll('.sk').length"), 4);
    assert.equal(await js("document.getElementById('bars').getAttribute('aria-busy')"), 'true');
    assert.equal(await js("document.getElementById('foottxt').textContent"), 'Carregando…');
  });

  await js(`window.__push.settings(${JSON.stringify(settings)}); window.__push.data(${JSON.stringify(reading())});`);
  await wait(150);

  await check('com dados: o esqueleto some e "ocupado" é removido', async () => {
    assert.equal(await js("document.querySelectorAll('.sk').length"), 0);
    assert.equal(await js("document.getElementById('bars').hasAttribute('aria-busy')"), false);
  });

  await check('cada barra é um progressbar com valor e texto que um leitor de tela lê', async () => {
    const bars = await js(`[...document.querySelectorAll('[role=progressbar]')].map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-valuenow'), b.getAttribute('aria-valuetext')])`);
    assert.equal(bars.length, 2);
    assert.deepEqual(bars[0].slice(0, 2), ['Claude · 5 horas', '44']);
    assert.match(bars[0][2], /^44%, reseta em/);
    assert.equal(bars[1][1], '95');
  });

  await check('a partir de 90% aparece o ⚠ (o estado não depende só de cor)', async () => {
    const pcs = await js("[...document.querySelectorAll('.pc')].map((p) => p.textContent)");
    assert.equal(pcs[0], '44%');
    assert.equal(pcs[1], '⚠ 95%');
  });

  await check('botões só de ícone têm nome acessível e o ⚙ informa se está pressionado', async () => {
    const names = await js("['r','g','x'].map((id) => document.getElementById(id).getAttribute('aria-label'))");
    assert.deepEqual(names, ['Atualizar agora', 'Configurações', 'Fechar o painel']);
    assert.equal(await js("document.getElementById('g').getAttribute('aria-pressed')"), 'false');
    assert.equal(await js("[...document.querySelectorAll('header button')].every((b) => b.type === 'button')"), true);
  });

  await check('o aviso de atualização é uma região ao vivo (anunciado sem roubar o foco)', async () => {
    assert.equal(await js("document.getElementById('upd').getAttribute('role')"), 'status');
    assert.equal(await js("document.getElementById('upd').getAttribute('aria-live')"), 'polite');
  });

  await check('erro vem com ação: botão "Tentar de novo" dentro de um alerta', async () => {
    assert.equal(await js("document.querySelector('.errcard').getAttribute('role')"), 'alert');
    assert.equal(await js("document.querySelector('.errcard button').textContent"), 'Tentar de novo');
  });

  await check('agrupamento: só a primeira linha de cada serviço (menos a primeira de todas) ganha o espaço extra', async () => {
    await js(`window.__push.data(${JSON.stringify(reading2())})`);
    await wait(100);
    const groups = await js("[...document.querySelectorAll('.brow')].map((b) => [b.getAttribute('aria-label'), b.classList.contains('newsvc')])");
    assert.deepEqual(groups, [['Claude · 5 horas', false], ['Claude · Semanal', false], ['Codex · 5 horas', true], ['Codex · Semanal', false]]);
    await js(`window.__push.data(${JSON.stringify(reading())})`); // volta ao estado dos próximos testes
    await wait(100);
  });

  await check('frescor: dado com mais de 2 min mostra a idade; com mais de 5 min o rodapé fica âmbar', async () => {
    // "min + 30 s" atrás: no MEIO do minuto, para 1 ms de diferença entre os relógios não mudar o piso
    const at = (min) => JSON.stringify({ ...reading(), updatedAt: Date.now() - (min * 60 + 30) * 1000 });
    await js(`window.__push.data(${at(0)})`); await wait(50);
    assert.doesNotMatch(await js("document.getElementById('foottxt').textContent"), /há /);
    assert.equal(await js("document.getElementById('foottxt').classList.contains('old')"), false);
    await js(`window.__push.data(${at(3)})`); await wait(50);
    assert.match(await js("document.getElementById('foottxt').textContent"), /atualizado \d\d:\d\d · há 3 min$/);
    assert.equal(await js("document.getElementById('foottxt').classList.contains('old')"), false);
    await js(`window.__push.data(${at(12)})`); await wait(50);
    assert.match(await js("document.getElementById('foottxt').textContent"), /há 12 min$/);
    assert.equal(await js("document.getElementById('foottxt').classList.contains('old')"), true);
    await js(`window.__push.data(${at(130)})`); await wait(50);
    assert.match(await js("document.getElementById('foottxt').textContent"), /há 2 h$/);
    await js(`window.__push.data(${at(0)})`); await wait(50);
  });

  await check('o botão de tentar de novo fica sempre numa linha própria, abaixo do texto', async () => {
    assert.equal(await js("getComputedStyle(document.querySelector('.errcard button')).display"), 'block');
  });

  await check('a legenda do ritmo some quando só há erros (sem barras) e volta com as barras', async () => {
    assert.equal(await js("getComputedStyle(document.querySelector('footer .legend')).visibility"), 'visible');
    await js(`window.__push.data(${JSON.stringify({ updatedAt: Date.now(), accent: '#0067c0', claude: { ok: false, error: 'x' }, codex: { ok: false, error: 'y' } })})`);
    await wait(100);
    assert.equal(await js("getComputedStyle(document.querySelector('footer .legend')).visibility"), 'hidden');
    await js(`window.__push.data(${JSON.stringify(reading())})`);
    await wait(100);
    assert.equal(await js("getComputedStyle(document.querySelector('footer .legend')).visibility"), 'visible');
  });

  await check('atualizar (botão do erro): ⟳ gira, fica desabilitado, rodapé diz "Atualizando…", e volta quando chega a leitura', async () => {
    await js("document.querySelector('.errcard button').click()");
    assert.ok((await calls()).includes('refresh'));
    assert.equal(await js("document.getElementById('r').classList.contains('spin')"), true);
    assert.equal(await js("document.getElementById('r').disabled"), true);
    assert.equal(await js("document.getElementById('foottxt').textContent"), 'Atualizando…');
    await js(`window.__push.data(${JSON.stringify(reading())})`);
    await wait(900); // o giro dura pelo menos 0,6 s
    assert.equal(await js("document.getElementById('r').classList.contains('spin')"), false);
    assert.equal(await js("document.getElementById('r').disabled"), false);
    assert.match(await js("document.getElementById('foottxt').textContent"), /^atualizado \d\d:\d\d$/);
  });

  await check('cliques repetidos em atualizar não disparam leituras repetidas', async () => {
    await js('window.__calls.length = 0');
    await js("document.getElementById('r').click(); document.getElementById('r').click(); document.getElementById('r').click();");
    // o botão fica desabilitado, mas F5 e o botão do cartão de erro não: quem segura esses é a trava interna
    await key('F5'); await key('F5');
    await js("(document.querySelector('.errcard button') || { click() {} }).click()");
    assert.equal((await calls()).filter((c) => c === 'refresh').length, 1);
    await js(`window.__push.data(${JSON.stringify(reading())})`);
    await wait(900);
  });

  await check('teclado: F5 atualiza', async () => {
    await js('window.__calls.length = 0');
    await key('F5');
    assert.ok((await calls()).includes('refresh'));
    await js(`window.__push.data(${JSON.stringify(reading())})`);
    await wait(900);
  });

  await check('teclado: Ctrl+, abre as configurações; Esc volta; Esc de novo esconde o painel', async () => {
    await js('window.__calls.length = 0');
    await key(',', { ctrlKey: true });
    assert.equal(await js("document.body.classList.contains('cfg')"), true);
    assert.equal(await js("document.getElementById('g').getAttribute('aria-pressed')"), 'true');
    await key('Escape');
    assert.equal(await js("document.body.classList.contains('cfg')"), false);
    assert.equal((await calls()).includes('hidePanel'), false, 'o primeiro Esc só volta das configurações');
    await key('Escape');
    assert.ok((await calls()).includes('hidePanel'));
  });

  await check('configurações: com todas as seções abertas a altura fica limitada e o conteúdo rola por dentro', async () => {
    await key(',', { ctrlKey: true });
    await js("document.querySelectorAll('details.ps').forEach((d) => { d.open = true; })");
    await wait(150);
    const m = await js(`(() => { const p = document.getElementById('set'); return { card: document.getElementById('card').offsetHeight,
      client: p.clientHeight, scroll: p.scrollHeight, overflowY: getComputedStyle(p).overflowY, header: document.querySelector('header').getBoundingClientRect().top }; })()`);
    assert.ok(m.card <= 520, `o painel das configurações tem ${m.card}px; o limite é 520`);
    assert.ok(m.scroll > m.client + 100, `o conteúdo (${m.scroll}px) deveria ser bem maior que a área visível (${m.client}px)`);
    assert.equal(m.overflowY, 'auto');
    // rolar por dentro não mexe no cabeçalho
    await js("document.getElementById('set').scrollTop = 200");
    await wait(60);
    assert.equal(await js("document.querySelector('header').getBoundingClientRect().top"), m.header);
    assert.ok(await js("document.getElementById('set').scrollTop") > 0, 'rolou');
    // volta ao estado inicial para os próximos testes
    await js("document.getElementById('set').scrollTop = 0; document.querySelectorAll('details.ps').forEach((d) => { d.open = false; })");
    await key('Escape');
  });

  await check('configurações: todas as seções começam recolhidas', async () => {
    assert.equal(await js("document.querySelectorAll('details.ps').length"), 6);
    assert.equal(await js("document.querySelectorAll('details.ps[open]').length"), 0);
  });

  await check('texto sobre o destaque do Windows: branco em azul escuro, texto escuro em amarelo claro', async () => {
    const onAccent = async (hex) => { await js(`setAccent('${hex}')`); return js("getComputedStyle(document.documentElement).getPropertyValue('--on-accent').trim()"); };
    assert.equal(await onAccent('#0067c0'), '#ffffff');
    assert.equal(await onAccent('#ffd54f'), '#111114');
    assert.equal(await onAccent('#d97757'), '#111114'); // laranja médio: branco não chega a 4,5:1
  });

  await check('tema: três opções, a atual fica marcada, e escolher uma envia o pedido', async () => {
    await js(`window.__push.settings(${JSON.stringify({ ...settings, theme: 'dark' })})`);
    const chips = await js("[...document.querySelectorAll('#th-chips .chip')].map((c) => [c.textContent, c.getAttribute('aria-pressed')])");
    assert.deepEqual(chips, [['Sistema', 'false'], ['Claro', 'false'], ['Escuro', 'true']]);
    await js('window.__calls.length = 0');
    await js("document.querySelector('#th-chips .chip[data-v=light]').click()");
    assert.deepEqual(await js('window.__calls.filter((c) => c[0] === "setTheme")'), [['setTheme', 'light']]);
  });

  await check('tema forçado deixa o fundo mais opaco; "Sistema" volta ao vidro', async () => {
    await js(`window.__push.settings(${JSON.stringify({ ...settings, theme: 'light' })})`);
    assert.equal(await js("document.documentElement.hasAttribute('data-forced')"), true);
    await js(`window.__push.settings(${JSON.stringify({ ...settings, theme: 'system' })})`);
    assert.equal(await js("document.documentElement.hasAttribute('data-forced')"), false);
  });

  await check('quem pede menos movimento não vê animações (regra @media presente)', async () => {
    const found = await js(`[...document.styleSheets].some((s) => [...s.cssRules].some((r) => r.type === CSSRule.MEDIA_RULE && /prefers-reduced-motion/.test(r.conditionText || r.media.mediaText)))`);
    assert.equal(found, true);
  });

  await check('a legenda explica o traço branco das barras (ritmo esperado)', async () => {
    assert.match(await js("document.querySelector('footer .legend').textContent"), /ritmo esperado/);
  });

  console.log('\nTESTE DE INTERFACE');
  for (const [s, n] of results) console.log(`  ${s} ${n}`);
  console.log(failures ? `\n${failures} falha(s)` : `\nTodas as ${results.length} verificações passaram`);
  app.exit(failures ? 1 : 0);
});
