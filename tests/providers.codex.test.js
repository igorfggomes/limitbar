const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, rmDir } = require('./helpers');
const providers = require('../providers');

let home;
test.beforeEach(() => { home = tmpDir('limitbar-codex-'); process.env.CODEX_HOME = home; });
test.afterEach(() => { delete process.env.CODEX_HOME; rmDir(home); });

const sec = (ms) => Math.floor(ms / 1000);
const line = (used5, reset5, usedW, resetW) => JSON.stringify({
  timestamp: '2026-10-20T10:00:00Z', type: 'event_msg',
  payload: { type: 'token_count', rate_limits: {
    primary: { used_percent: used5, window_minutes: 300, resets_at: reset5 },
    secondary: { used_percent: usedW, window_minutes: 10080, resets_at: resetW }, plan_type: 'plus' } },
});
function session(name, lines, mtime) {
  const d = path.join(home, 'sessions', '2026', '10', '20');
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, name);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  if (mtime) fs.utimesSync(f, mtime, mtime);
  return f;
}

test('primeiro uso: sem a pasta do Codex, explica como instalar', async () => {
  fs.rmSync(home, { recursive: true, force: true });
  const r = await providers.codex();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not-installed');
  assert.match(r.error, /codex/);
});

test('instalado mas ainda sem uso: pede para usar uma vez', async () => {
  const r = await providers.codex();
  assert.equal(r.code, 'no-data');
  assert.match(r.error, /Use-o uma vez/);
});

test('sessão sem informação de limite também cai em "sem dados"', async () => {
  session('a.jsonl', [JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message' } })]);
  assert.equal((await providers.codex()).code, 'no-data');
});

test('lê o registro de limites mais recente do arquivo', async () => {
  const future5 = Date.now() + 3 * 3600e3, futureW = Date.now() + 5 * 86400e3;
  session('a.jsonl', [line(10, sec(future5), 20, sec(futureW)), line(35, sec(future5), 28, sec(futureW))]);
  const r = await providers.codex();
  assert.equal(r.ok, true);
  assert.equal(r.plan, 'plus');
  assert.deepEqual(r.windows.map((w) => [w.label, w.percent]), [['5 horas', 35], ['Semanal', 28]]);
  assert.equal(r.windows[0].windowMs, 300 * 60e3);
  assert.equal(r.windows[1].windowMs, 10080 * 60e3);
});

test('usa o arquivo de sessão mais recente', async () => {
  const f5 = Date.now() + 3 * 3600e3, fw = Date.now() + 5 * 86400e3;
  session('velho.jsonl', [line(90, sec(f5), 90, sec(fw))], new Date(Date.now() - 86400e3));
  session('novo.jsonl', [line(7, sec(f5), 9, sec(fw))], new Date());
  assert.equal((await providers.codex()).windows[0].percent, 7);
});

test('janela que já resetou desde o último registro volta a 0%', async () => {
  const past = Date.now() - 3600e3, futureW = Date.now() + 5 * 86400e3;
  session('a.jsonl', [line(80, sec(past), 40, sec(futureW))]);
  const r = await providers.codex();
  assert.equal(r.windows[0].percent, 0);
  assert.equal(r.windows[0].resetsAt, null);
  assert.equal(r.windows[1].percent, 40);
});

test('linha cortada no fim do arquivo não impede a leitura', async () => {
  const f5 = Date.now() + 3 * 3600e3, fw = Date.now() + 5 * 86400e3;
  session('a.jsonl', [line(22, sec(f5), 11, sec(fw)), '{"payload":{"rate_limits":{"prim']);
  assert.equal((await providers.codex()).windows[0].percent, 22);
});
