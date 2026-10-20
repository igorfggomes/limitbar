const test = require('node:test');
const assert = require('node:assert/strict');
const ka = require('../lib/keepalive');

const H = 3600e3, MIN = 60e3;
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const win5 = (percent, resetsAt) => ({ label: '5 horas', percent, resetsAt, windowMs: 5 * H });
const week = { label: 'Semanal', percent: 20, resetsAt: NOW + 80 * H, windowMs: 168 * H };
const active = (percent = 10) => ({ ok: true, windows: [win5(percent, NOW + 2 * H), week] });
const inactive = { ok: true, windows: [win5(0, null), week] };
const ON = { enabled: true, services: { claude: true, codex: true }, ceilingPct: 2 };
const base = { svc: 'claude', reading: inactive, cfg: ON, attempts: [], episode: 0, now: NOW + 10 * MIN, startedAt: NOW };
const att = (svc, at, ok = true, extra = {}) => ({ svc, at, ok, started: ok, cost: 0.5, test: false, message: '', ...extra });

// ------------------------------------------------------------------ configuração
test('config: desligada por padrão e só liga com true explícito', () => {
  assert.equal(ka.normalizeConfig(undefined).enabled, false);
  for (const v of [1, 'true', 'yes', {}, []]) assert.equal(ka.normalizeConfig({ enabled: v }).enabled, false);
  assert.equal(ka.normalizeConfig({ enabled: true }).enabled, true);
});

test('config: teto só aceita as opções oferecidas; o resto volta a 2%', () => {
  assert.equal(ka.normalizeConfig({}).ceilingPct, 2);
  assert.equal(ka.normalizeConfig({ ceilingPct: 5 }).ceilingPct, 5);
  for (const bad of [0, -1, 4, 50, '2.5', 'x', null]) assert.equal(ka.normalizeConfig({ ceilingPct: bad }).ceilingPct, 2);
  assert.equal(ka.normalizeConfig({ ceilingPct: '3' }).ceilingPct, 3);
});

test('config: serviços ficam ligados, a não ser que sejam desmarcados', () => {
  assert.deepEqual(ka.normalizeConfig({ services: { codex: false } }).services, { claude: true, codex: false });
});

// ------------------------------------------------------------------ estado da janela
test('fiveHourState: ativa, inativa e dúvida', () => {
  assert.equal(ka.fiveHourState(active(), NOW), 'active');
  assert.equal(ka.fiveHourState(inactive, NOW), 'inactive');
  assert.equal(ka.fiveHourState({ ok: true, windows: [week] }, NOW), 'inactive', 'sem janela de 5h no retorno');
  assert.equal(ka.fiveHourState({ ok: true, windows: [win5(40, NOW - 1000)] }, NOW), 'inactive', 'reset já passou');
});

test('fiveHourState: na dúvida nunca é "inativa"', () => {
  assert.equal(ka.fiveHourState(null, NOW), 'unknown');
  assert.equal(ka.fiveHourState({ ok: false, code: 'network' }, NOW), 'unknown');
  assert.equal(ka.fiveHourState({ ok: false, code: 'rate-limited' }, NOW), 'unknown');
  assert.equal(ka.fiveHourState({ ok: false, code: 'not-logged-in' }, NOW), 'unknown');
  assert.equal(ka.fiveHourState({ ok: true, stale: true, windows: [win5(0, null)] }, NOW), 'unknown', 'valor guardado');
});

test('fiveHourState: Codex instalado e nunca usado conta como inativo', () => {
  assert.equal(ka.fiveHourState({ ok: false, code: 'no-data' }, NOW), 'inactive');
});

// ------------------------------------------------------------------ decide
test('decide: dispara quando está tudo certo', () => {
  assert.deepEqual(ka.decide(base), { trigger: true });
});

test('decide: desligado, serviço desmarcado ou desativado pelo teto não dispara', () => {
  assert.equal(ka.decide({ ...base, cfg: { ...ON, enabled: false } }).reason, 'off');
  assert.equal(ka.decide({ ...base, cfg: { ...ON, services: { claude: false, codex: true } } }).reason, 'off');
  assert.equal(ka.decide({ ...base, disabled: true }).reason, 'disabled');
});

test('decide: janela ativa ou leitura duvidosa não dispara', () => {
  assert.equal(ka.decide({ ...base, reading: active() }).reason, 'active');
  assert.equal(ka.decide({ ...base, reading: { ok: false, code: 'network' } }).reason, 'unknown');
});

test('decide: espera um minuto depois de abrir o app', () => {
  assert.equal(ka.decide({ ...base, now: NOW + 30e3 }).reason, 'startup');
  assert.equal(ka.decide({ ...base, now: NOW + 61e3 }).trigger, true);
});

test('decide: depois de um disparo, espera a leitura mostrar a janela', () => {
  const attempts = [att('claude', NOW + 10 * MIN)];
  assert.equal(ka.decide({ ...base, attempts, now: NOW + 15 * MIN }).reason, 'wait');
  assert.equal(ka.decide({ ...base, attempts, now: NOW + 23 * MIN }).trigger, true);
});

test('decide: falhas esperam cada vez mais (10, 20, 40 min)', () => {
  const t0 = NOW + 10 * MIN;
  const one = [att('claude', t0, false)];
  assert.equal(ka.decide({ ...base, attempts: one, now: t0 + 9 * MIN }).reason, 'wait');
  assert.equal(ka.decide({ ...base, attempts: one, now: t0 + 11 * MIN }).trigger, true);
  const two = [att('claude', t0 - 30 * MIN, false), att('claude', t0, false)];
  assert.equal(ka.decide({ ...base, attempts: two, now: t0 + 15 * MIN }).reason, 'wait');
  assert.equal(ka.decide({ ...base, attempts: two, now: t0 + 21 * MIN }).trigger, true);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(ka.backoffFor), [10, 20, 40, 60, 120, 120].map((m) => m * MIN));
});

test('decide: o histórico de um serviço não atrasa o outro', () => {
  const attempts = [att('codex', NOW + 10 * MIN)];
  assert.equal(ka.decide({ ...base, svc: 'claude', attempts, now: NOW + 11 * MIN }).trigger, true);
});

test('decide: desiste depois de 3 tentativas na mesma janela inativa', () => {
  assert.equal(ka.decide({ ...base, episode: 2 }).trigger, true);
  assert.equal(ka.decide({ ...base, episode: 3 }).reason, 'gave-up');
});

test('decide: limite de 8 tentativas por dia, contando só as últimas 24h', () => {
  const recent = Array.from({ length: 8 }, (_, i) => att('claude', NOW + 10 * MIN - (i + 1) * 2.5 * H));
  assert.equal(ka.decide({ ...base, attempts: recent, now: NOW + 10 * MIN }).reason, 'daily-cap');
  const old = recent.map((a) => ({ ...a, at: a.at - 24 * H }));
  assert.equal(ka.decide({ ...base, attempts: old }).trigger, true);
});

test('decide: tentativas de teste não contam para espera nem limites', () => {
  const tests = Array.from({ length: 10 }, () => att('claude', NOW + 9 * MIN, true, { test: true }));
  assert.equal(ka.decide({ ...base, attempts: tests }).trigger, true);
});

// ------------------------------------------------------------------ orquestrador
function harness({ run, fresh, saved } = {}) {
  let t = NOW;
  const calls = [], notes = [], saves = [];
  const store = { load: () => saved || { attempts: [], disabled: {} }, save: (s) => saves.push(JSON.parse(JSON.stringify(s))) };
  const k = ka.createKeepAlive({
    runCommand: async (svc) => { calls.push(svc); return run ? run(svc) : { ok: true }; },
    readFresh: async (svc) => (fresh ? fresh(svc) : { ok: true, windows: [win5(0.6, t + 5 * H), week] }),
    notify: (n) => notes.push(n), store, now: () => t,
  });
  return { k, calls, notes, saves, advance: (ms) => { t += ms; }, at: () => t };
}
const both = (r) => ({ claude: r, codex: { ok: true, windows: [win5(5, NOW + 3 * H)] } }); // codex ativo: só o claude interessa

test('tick: janela parada -> dispara, mede o custo e guarda o resultado', async () => {
  const h = harness();
  h.advance(2 * MIN);
  await h.k.tick(both(inactive), ON);
  assert.deepEqual(h.calls, ['claude']);
  const last = h.k.status().last.claude;
  assert.equal(last.ok, true);
  assert.equal(last.started, true);
  assert.equal(last.cost, 0.6);
  assert.equal(h.saves.length, 1, 'persistiu o histórico');
  assert.equal(h.notes.length, 0);
});

test('tick: janela ativa não dispara', async () => {
  const h = harness();
  h.advance(2 * MIN);
  await h.k.tick(both(active()), ON);
  assert.deepEqual(h.calls, []);
});

test('tick: nada acontece nos primeiros 60 segundos nem com a função desligada', async () => {
  const h = harness();
  await h.k.tick(both(inactive), ON);
  assert.deepEqual(h.calls, []);
  h.advance(2 * MIN);
  await h.k.tick(both(inactive), { ...ON, enabled: false });
  assert.deepEqual(h.calls, []);
});

test('tick: serviços funcionam de forma independente (Claude e Codex)', async () => {
  const h = harness();
  h.advance(2 * MIN);
  await h.k.tick({ claude: inactive, codex: { ok: false, code: 'no-data' } }, ON);
  assert.deepEqual(h.calls, ['claude', 'codex']);
});

test('tick: custo acima do teto desliga só aquele serviço e avisa', async () => {
  const h = harness({ fresh: () => ({ ok: true, windows: [win5(3.4, NOW + 5 * H)] }) });
  h.advance(2 * MIN);
  await h.k.tick({ claude: inactive, codex: { ok: true, windows: [win5(5, NOW + 3 * H)] } }, ON);
  assert.equal(h.k.status().disabled.claude.cost, 3.4);
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0].body, /3\.4%.*2%/);
  h.advance(30 * MIN);
  await h.k.tick(both(inactive), ON);
  assert.deepEqual(h.calls, ['claude'], 'não dispara de novo');
  h.k.clearDisabled('claude');
  h.advance(30 * MIN);
  await h.k.tick(both(inactive), ON);
  assert.deepEqual(h.calls, ['claude', 'claude'], 'volta depois de religar');
});

test('tick: custo no teto exato é aceito', async () => {
  const h = harness({ fresh: () => ({ ok: true, windows: [win5(2, NOW + 5 * H)] }) });
  h.advance(2 * MIN);
  await h.k.tick(both(inactive), ON);
  assert.equal(h.k.status().disabled.claude, null);
});

test('tick: se a janela já estava em andamento, mede só a diferença', async () => {
  const h = harness({ fresh: () => ({ ok: true, windows: [win5(10.8, NOW + 5 * H)] }) });
  h.advance(2 * MIN);
  const [r] = await h.k.testNow(['claude'], { claude: { ok: true, windows: [win5(10, NOW + 3 * H)] } }, ON);
  assert.equal(r.cost, 0.8);
});

test('tick: falha no comando espera antes de tentar de novo, com espera crescente', async () => {
  let n = 0;
  const h = harness({ run: () => ({ ok: false, error: `falha ${++n}` }) });
  h.advance(2 * MIN);
  await h.k.tick(both(inactive), ON);
  assert.equal(h.k.status().last.claude.ok, false);
  assert.match(h.k.status().last.claude.message, /falha 1/);
  h.advance(1 * MIN); await h.k.tick(both(inactive), ON);
  assert.equal(h.calls.length, 1, 'ainda esperando');
  h.advance(10 * MIN); await h.k.tick(both(inactive), ON);
  assert.equal(h.calls.length, 2);
});

test('tick: se a janela não aparece, desiste depois de 3 tentativas e avisa uma vez só', async () => {
  const h = harness({ fresh: () => ({ ok: true, windows: [win5(0, null)] }) }); // nunca inicia
  h.advance(2 * MIN);
  for (let i = 0; i < 6; i++) { await h.k.tick(both(inactive), ON); h.advance(30 * MIN); }
  assert.equal(h.calls.length, 3);
  assert.equal(h.notes.filter((n) => /Não consegui/.test(n.title)).length, 1);
});

test('tick: ver a janela ativa zera o "desisti" e permite tentar no próximo reset', async () => {
  const h = harness({ fresh: () => ({ ok: true, windows: [win5(0, null)] }) });
  h.advance(2 * MIN);
  for (let i = 0; i < 4; i++) { await h.k.tick(both(inactive), ON); h.advance(30 * MIN); }
  assert.equal(h.calls.length, 3);
  await h.k.tick(both(active()), ON); // o usuário começou a usar: janela ativa
  h.advance(6 * H);
  await h.k.tick(both(inactive), ON);
  assert.equal(h.calls.length, 4);
});

test('tick: nunca roda duas tentativas ao mesmo tempo', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ run: async () => { await gate; return { ok: true }; } });
  h.advance(2 * MIN);
  const first = h.k.tick(both(inactive), ON);
  await h.k.tick(both(inactive), ON); // volta na hora
  assert.equal(h.k.status().running, true);
  release(); await first;
  assert.equal(h.calls.length, 1);
  assert.equal(h.k.status().running, false);
});

test('tick: erro ao ler o uso depois do disparo não quebra e não inventa custo', async () => {
  const h = harness({ fresh: () => { throw new Error('rede'); } });
  h.advance(2 * MIN);
  await h.k.tick(both(inactive), ON);
  const last = h.k.status().last.claude;
  assert.equal(last.cost, null);
  assert.equal(h.k.status().running, false);
});

test('persistência: depois de reabrir o app, a espera do último disparo continua valendo', async () => {
  const h1 = harness();
  h1.advance(2 * MIN);
  await h1.k.tick(both(inactive), ON);
  const saved = h1.saves[h1.saves.length - 1];
  const h2 = harness({ saved }); // "novo app" com o histórico gravado
  h2.advance(2 * MIN); // ~ mesmo instante: o último disparo foi há poucos minutos
  await h2.k.tick(both(inactive), ON);
  assert.deepEqual(h2.calls, [], 'não repete logo depois de reabrir');
});

test('persistência: serviço desligado pelo teto continua desligado depois de reabrir', async () => {
  const h = harness({ saved: { attempts: [], disabled: { claude: { at: NOW, cost: 4, ceiling: 2 } } } });
  h.advance(2 * MIN);
  await h.k.tick(both(inactive), ON);
  assert.deepEqual(h.calls, []);
});

test('testNow: roda uma vez por serviço mesmo desligado, sem desligar nada nem contar como tentativa', async () => {
  const h = harness({ fresh: () => ({ ok: true, windows: [win5(9, NOW + 5 * H)] }) }); // custo alto
  const out = await h.k.testNow(['claude', 'codex'], { claude: inactive, codex: inactive }, { ...ON, enabled: false });
  assert.equal(out.length, 2);
  assert.ok(out.every((e) => e.test));
  assert.equal(h.k.status().disabled.claude, null, 'teste só informa');
  assert.equal(h.k._state.episode.claude, 0);
  assert.equal(h.notes.length, 0);
});
