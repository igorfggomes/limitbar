const test = require('node:test');
const assert = require('node:assert/strict');
const alerts = require('../lib/alerts');

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const H = 3600e3;
const CFG = { enabled: true, levels: [80, 95], onReset: true, services: { claude: true, codex: true } };
const reading = (percent, resetsAt = NOW + 3 * H, label = '5 horas') => ({ ok: true, windows: [{ label, percent, resetsAt, windowMs: 5 * H }] });
const run = (eng, p, cfg = CFG, svc = 'claude', now = NOW) => eng.evaluate(svc, svc === 'claude' ? 'Claude' : 'Codex', p, cfg, now);

test('a primeira leitura só aprende o estado: não avisa ao abrir o app', () => {
  const eng = alerts.create();
  assert.deepEqual(run(eng, reading(90)), []);
});

test('avisa ao cruzar cada nível, uma vez só', () => {
  const eng = alerts.create();
  run(eng, reading(50));
  const a = run(eng, reading(82));
  assert.equal(a.length, 1);
  assert.equal(a[0].level, 80);
  assert.match(a[0].body, /82%/);
  assert.deepEqual(run(eng, reading(85)), [], 'mesma faixa não repete');
  const b = run(eng, reading(96));
  assert.equal(b.length, 1);
  assert.equal(b[0].level, 95);
});

test('depois de um reset, os avisos voltam a valer', () => {
  const eng = alerts.create();
  run(eng, reading(10));
  assert.equal(run(eng, reading(90)).length, 1);
  run(eng, reading(5, NOW + 5 * H)); // resetou
  assert.equal(run(eng, reading(88, NOW + 5 * H)).length, 1);
});

test('níveis personalizados', () => {
  const eng = alerts.create();
  const cfg = { ...CFG, levels: [50, 70] };
  run(eng, reading(10), cfg);
  assert.equal(run(eng, reading(55), cfg)[0].level, 50);
  assert.equal(run(eng, reading(75), cfg)[0].level, 70);
});

test('alertas desligados ou serviço silenciado não avisam', () => {
  const off = alerts.create();
  run(off, reading(10), { ...CFG, enabled: false });
  assert.deepEqual(run(off, reading(99), { ...CFG, enabled: false }), []);

  const muted = alerts.create();
  const cfg = { ...CFG, services: { claude: false, codex: true } };
  run(muted, reading(10), cfg);
  assert.deepEqual(run(muted, reading(99), cfg), []);
  // o outro serviço continua avisando
  run(muted, reading(10), cfg, 'codex');
  assert.equal(run(muted, reading(99), cfg, 'codex').length, 1);
});

test('reseed: mudar os níveis não dispara aviso do que já estava acima', () => {
  const eng = alerts.create();
  run(eng, reading(60));
  eng.reseed();
  assert.deepEqual(run(eng, reading(60), { ...CFG, levels: [50] }), []);
});

test('reset: avisa quando uma janela bem usada volta a zero (Claude: reset avança)', () => {
  const eng = alerts.create();
  run(eng, reading(92, NOW + 1 * H));
  const r = run(eng, reading(2, NOW + 5 * H), CFG, 'claude', NOW + 1 * H);
  const reset = r.find((n) => n.kind === 'reset');
  assert.ok(reset);
  assert.match(reset.body, /resetou/);
  assert.match(reset.body, /2%/);
});

test('reset: janela que expirou sem nova leitura (Codex) também conta', () => {
  const eng = alerts.create();
  run(eng, reading(75, NOW + 1 * H), CFG, 'codex');
  const r = run(eng, { ok: true, windows: [{ label: '5 horas', percent: 0, resetsAt: null, windowMs: 5 * H }] }, CFG, 'codex', NOW + 2 * H);
  assert.ok(r.find((n) => n.kind === 'reset'));
});

test('reset: quem tinha usado pouco não é avisado a cada janela', () => {
  const eng = alerts.create();
  run(eng, reading(20, NOW + 1 * H));
  assert.deepEqual(run(eng, reading(0, NOW + 5 * H), CFG, 'claude', NOW + 1 * H).filter((n) => n.kind === 'reset'), []);
});

test('reset: pode ser desligado', () => {
  const eng = alerts.create();
  const cfg = { ...CFG, onReset: false };
  run(eng, reading(92, NOW + 1 * H), cfg);
  assert.deepEqual(run(eng, reading(2, NOW + 5 * H), cfg, 'claude', NOW + 1 * H).filter((n) => n.kind === 'reset'), []);
});

test('leitura com erro não gera avisos nem quebra', () => {
  const eng = alerts.create();
  assert.deepEqual(run(eng, { ok: false, error: 'x' }), []);
  assert.deepEqual(run(eng, null), []);
});

test('normalizeConfig: vazio ou inválido vira a configuração padrão', () => {
  for (const bad of [undefined, null, 'x', 42, []]) {
    assert.deepEqual(alerts.normalizeConfig(bad), alerts.DEFAULTS);
  }
});

test('normalizeConfig: níveis são filtrados, sem repetição, ordenados e limitados', () => {
  const c = alerts.normalizeConfig({ levels: [95, '80', 80, 0, 101, -5, 3.5, 'abc', null, 50, 70, 90, 60, 55] });
  assert.deepEqual(c.levels, [50, 55, 60, 70, 80, 90]);
});

test('normalizeConfig: lista vazia de níveis é respeitada (só avisa o reset)', () => {
  assert.deepEqual(alerts.normalizeConfig({ levels: [] }).levels, []);
});

test('normalizeConfig: só "false" desliga; o resto mantém o padrão ligado', () => {
  const c = alerts.normalizeConfig({ enabled: false, onReset: false, services: { claude: false } });
  assert.equal(c.enabled, false);
  assert.equal(c.onReset, false);
  assert.deepEqual(c.services, { claude: false, codex: true });
  assert.equal(alerts.normalizeConfig({ enabled: 0 }).enabled, true);
});

test('normalizeConfig: não altera o objeto de entrada nem o DEFAULTS', () => {
  const input = { levels: [90, 50] };
  alerts.normalizeConfig(input);
  assert.deepEqual(input.levels, [90, 50]);
  const c = alerts.normalizeConfig({});
  c.levels.push(1);
  assert.deepEqual(alerts.DEFAULTS.levels, [80, 95]);
});
