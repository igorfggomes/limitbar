// projects/limitbar/tests/signals.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, rmDir } = require('./helpers');
const signals = require('../lib/signals');

test('normalizeConfig: padrão desligado, serviços ligados', () => {
  assert.deepEqual(signals.normalizeConfig({}), { enabled: false, services: { claude: true, codex: true } });
  assert.deepEqual(signals.normalizeConfig(undefined), signals.DEFAULTS);
});

test('normalizeConfig: só "true" explícito liga', () => {
  assert.equal(signals.normalizeConfig({ enabled: true }).enabled, true);
  assert.equal(signals.normalizeConfig({ enabled: 1 }).enabled, false);
});

test('normalizeConfig: serviço silenciado individualmente', () => {
  assert.deepEqual(signals.normalizeConfig({ services: { claude: false } }).services, { claude: false, codex: true });
});

test('parseLines: ignora linhas vazias e JSON inválido', () => {
  const out = signals.parseLines('{"svc":"claude","kind":"stop","ts":1}\n\n{quebrado\n{"svc":"codex","kind":"turn-complete","ts":2}\n');
  assert.deepEqual(out, [{ svc: 'claude', kind: 'stop', ts: 1 }, { svc: 'codex', kind: 'turn-complete', ts: 2 }]);
});

test('readNew: lê só o que foi adicionado depois do offset', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'events.log');
  fs.writeFileSync(file, '{"svc":"claude","kind":"stop","ts":1}\n');
  const first = signals.readNew(file, 0);
  assert.equal(first.events.length, 1);
  fs.appendFileSync(file, '{"svc":"claude","kind":"notification","ts":2}\n');
  const second = signals.readNew(file, first.offset);
  assert.deepEqual(second.events, [{ svc: 'claude', kind: 'notification', ts: 2 }]);
  rmDir(dir);
});

test('readNew: arquivo inexistente não lança, offset fica 0', () => {
  const r = signals.readNew(path.join(require('os').tmpdir(), 'nao-existe-' + Date.now() + '.log'), 0);
  assert.deepEqual(r, { events: [], offset: 0 });
});

test('readNew: arquivo truncado externamente (offset maior que o tamanho) relê do início', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'events.log');
  fs.writeFileSync(file, '{"svc":"codex","kind":"turn-complete","ts":3}\n');
  const r = signals.readNew(file, 999999);
  assert.equal(r.events.length, 1);
  rmDir(dir);
});
