const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, rmDir, json, fakeFetch, isoIn } = require('./helpers');
const providers = require('../providers');

const USAGE = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN = 'https://platform.claude.com/v1/oauth/token';
const H = 3600e3;

let dir, realFetch, realNow, offset;
const credFile = () => path.join(dir, '.credentials.json');
const writeCreds = (o = {}, extra = {}) => fs.writeFileSync(credFile(), JSON.stringify({
  claudeAiOauth: { accessToken: 'AT1', refreshToken: 'RT1', expiresAt: Date.now() + H, scopes: ['user:inference', 'user:profile'],
    subscriptionType: 'max', rateLimitTier: 'tier-x', ...o }, mcpOAuth: { keep: 'me' }, ...extra }));
const readCreds = () => JSON.parse(fs.readFileSync(credFile(), 'utf8'));
const usageBody = (five = 12, week = 40) => ({
  five_hour: { utilization: five, resets_at: isoIn(3 * H) }, seven_day: { utilization: week, resets_at: isoIn(60 * H) },
});
// rota do uso que só aceita o token indicado
const usageFor = (okToken, body = usageBody()) => (_u, init) => (init.headers.Authorization === `Bearer ${okToken}` ? json(body) : json({}, 401));
const advance = (ms) => { offset += ms; };

test.beforeEach(() => {
  dir = tmpDir('limitbar-claude-');
  process.env.CLAUDE_CONFIG_DIR = dir;
  providers._resetForTests();
  realFetch = global.fetch; realNow = Date.now.bind(Date); offset = 0;
  Date.now = () => realNow() + offset;
});
test.afterEach(() => {
  global.fetch = realFetch; Date.now = realNow;
  delete process.env.CLAUDE_CONFIG_DIR;
  rmDir(dir);
});

test('lê o uso e devolve as duas janelas', async () => {
  writeCreds();
  global.fetch = fakeFetch([[USAGE, usageFor('AT1')]]);
  const r = await providers.claude();
  assert.equal(r.ok, true);
  assert.deepEqual(r.windows.map((w) => [w.label, w.percent]), [['5 horas', 12], ['Semanal', 40]]);
  assert.equal(r.windows[0].windowMs, 5 * H);
  assert.equal(r.stale, false);
});

test('primeiro uso: sem login, a mensagem diz o que fazer', async () => {
  global.fetch = fakeFetch([]);
  const r = await providers.claude();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not-logged-in');
  assert.match(r.error, /claude/);
  assert.equal(global.fetch.calls.length, 0, 'nem tenta a rede');
});

test('conta com chave de API explica que o limite é de assinatura', async () => {
  fs.writeFileSync(credFile(), JSON.stringify({ somethingElse: true }));
  global.fetch = fakeFetch([]);
  const r = await providers.claude();
  assert.equal(r.code, 'no-subscription');
  assert.match(r.error, /assinatura/);
});

test('arquivo de login corrompido é tratado como sem login', async () => {
  fs.writeFileSync(credFile(), '{ não é json');
  global.fetch = fakeFetch([]);
  assert.equal((await providers.claude()).code, 'not-logged-in');
});

test('token expirado: renova, grava no arquivo e usa o novo', async () => {
  writeCreds({ expiresAt: Date.now() - 1000 });
  let sent;
  global.fetch = fakeFetch([
    [TOKEN, (_u, init) => { sent = JSON.parse(init.body); return json({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, refresh_token_expires_in: 86400 }); }],
    [USAGE, usageFor('AT2')],
  ]);
  const r = await providers.claude();
  assert.equal(r.ok, true);
  // pedido igual ao do Claude Code
  assert.equal(sent.grant_type, 'refresh_token');
  assert.equal(sent.refresh_token, 'RT1');
  assert.equal(sent.client_id, '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
  assert.equal(sent.scope, 'user:inference user:profile');
  // arquivo atualizado sem perder o resto
  const f = readCreds();
  assert.equal(f.claudeAiOauth.accessToken, 'AT2');
  assert.equal(f.claudeAiOauth.refreshToken, 'RT2', 'o refresh token rotativo precisa ser gravado');
  assert.ok(f.claudeAiOauth.expiresAt > Date.now() + 3000e3);
  assert.ok(f.claudeAiOauth.refreshTokenExpiresAt > Date.now());
  assert.equal(f.claudeAiOauth.subscriptionType, 'max');
  assert.deepEqual(f.claudeAiOauth.scopes, ['user:inference', 'user:profile']);
  assert.deepEqual(f.mcpOAuth, { keep: 'me' });
  assert.deepEqual(fs.readdirSync(dir), ['.credentials.json'], 'não sobra arquivo temporário');
});

test('se o servidor não devolver refresh token novo, mantém o atual', async () => {
  writeCreds({ expiresAt: Date.now() - 1000 });
  global.fetch = fakeFetch([[TOKEN, () => json({ access_token: 'AT2', expires_in: 3600 })], [USAGE, usageFor('AT2')]]);
  assert.equal((await providers.claude()).ok, true);
  assert.equal(readCreds().claudeAiOauth.refreshToken, 'RT1');
});

test('o Claude Code renovou enquanto isso: o login dele vence e nada é sobrescrito', async () => {
  writeCreds({ expiresAt: Date.now() - 1000 });
  global.fetch = fakeFetch([
    [TOKEN, () => {
      // simula o Claude Code gravando um login novo no meio da nossa renovação
      writeCreds({ accessToken: 'AT-CC', refreshToken: 'RT-CC', expiresAt: Date.now() + H });
      return json({ access_token: 'AT-NOSSO', refresh_token: 'RT-NOSSO', expires_in: 3600 });
    }],
    [USAGE, usageFor('AT-CC')],
  ]);
  const r = await providers.claude();
  assert.equal(r.ok, true);
  const f = readCreds();
  assert.equal(f.claudeAiOauth.accessToken, 'AT-CC');
  assert.equal(f.claudeAiOauth.refreshToken, 'RT-CC');
});

test('renovação recusada: avisa que a sessão expirou, não grava e não insiste', async () => {
  writeCreds({ expiresAt: Date.now() - 1000 });
  const before = fs.readFileSync(credFile(), 'utf8');
  global.fetch = fakeFetch([[TOKEN, () => json({ error: 'invalid_grant' }, 400)], [USAGE, usageFor('AT1')]]);
  const r = await providers.claude();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'session-expired');
  assert.match(r.error, /claude/);
  assert.equal(fs.readFileSync(credFile(), 'utf8'), before, 'arquivo de login intacto');
  await providers.claude();
  assert.equal(global.fetch.count(TOKEN), 1, 'não repete o pedido logo em seguida');
});

test('com a renovação automática desligada, não chama o endpoint de token', async () => {
  providers.configure({ autoRefresh: false });
  writeCreds({ expiresAt: Date.now() - 1000 });
  global.fetch = fakeFetch([[USAGE, () => json({}, 401)], [TOKEN, () => json({ access_token: 'X', expires_in: 1 })]]);
  const r = await providers.claude();
  assert.equal(r.code, 'session-expired');
  assert.equal(global.fetch.count(TOKEN), 0);
});

test('401 inesperado (token ainda "válido"): renova uma vez e tenta de novo', async () => {
  writeCreds(); // expiresAt no futuro, mas o servidor recusa AT1
  global.fetch = fakeFetch([
    [TOKEN, () => json({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 })],
    [USAGE, usageFor('AT2')],
  ]);
  const r = await providers.claude();
  assert.equal(r.ok, true);
  assert.equal(global.fetch.count(USAGE), 2);
  assert.equal(global.fetch.count(TOKEN), 1);
});

test('falha na gravação não deixa lixo nem apaga o login', async () => {
  writeCreds({ expiresAt: Date.now() - 1000 });
  const realRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('disco cheio'); };
  global.fetch = fakeFetch([[TOKEN, () => json({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 })], [USAGE, usageFor('AT2')]]);
  try {
    const r = await providers.claude();
    assert.equal(r.ok, false);
  } finally { fs.renameSync = realRename; }
  assert.equal(readCreds().claudeAiOauth.accessToken, 'AT1');
  assert.deepEqual(fs.readdirSync(dir), ['.credentials.json']);
});

test('limite de consultas (429): mantém o último valor e espera antes de tentar de novo', async () => {
  writeCreds({ expiresAt: Date.now() + 100 * H });
  let mode = 'ok';
  global.fetch = fakeFetch([[USAGE, () => (mode === 'ok' ? json(usageBody(12, 40)) : json({}, 429, { 'retry-after': '120' }))]]);
  assert.equal((await providers.claude()).ok, true);

  mode = '429'; advance(200e3);
  const stale = await providers.claude();
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.windows[0].percent, 12);

  const calls = global.fetch.count(USAGE);
  advance(60e3); await providers.claude();
  assert.equal(global.fetch.count(USAGE), calls, 'durante a espera não consulta');
});

test('limite de consultas na primeira leitura mostra mensagem, não zeros', async () => {
  writeCreds({ expiresAt: Date.now() + 100 * H });
  global.fetch = fakeFetch([[USAGE, () => json({}, 429)]]);
  const r = await providers.claude();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'rate-limited');
});

test('rede fora do ar: mantém o último valor; sem valor, explica', async () => {
  writeCreds({ expiresAt: Date.now() + 100 * H });
  global.fetch = fakeFetch([[USAGE, () => json(usageBody())]]);
  await providers.claude();
  global.fetch = fakeFetch([]); // qualquer chamada falha como "fetch failed"
  advance(200e3);
  const stale = await providers.claude();
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);

  providers._resetForTests();
  const none = await providers.claude();
  assert.equal(none.ok, false);
  assert.equal(none.code, 'network');
  assert.match(none.error, /internet/);
});

test('janela que já resetou desde a leitura volta a 0%', async () => {
  writeCreds({ expiresAt: Date.now() + 100 * H });
  global.fetch = fakeFetch([[USAGE, () => json(usageBody(70, 10))]]);
  await providers.claude();
  global.fetch = fakeFetch([]);
  advance(4 * H); // passou do reset de 3h
  const r = await providers.claude();
  assert.equal(r.windows[0].percent, 0);
  assert.equal(r.windows[0].resetsAt, null);
  assert.equal(r.windows[1].percent, 10);
});
