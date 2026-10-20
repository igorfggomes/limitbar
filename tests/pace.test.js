const test = require('node:test');
const assert = require('node:assert/strict');
const { pace, exhaustion } = require('../lib/pace');

const H = 3600e3;
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
// janela de 5h com "elapsedH" horas já passadas
const win = (percent, elapsedH, windowH = 5) => ({ percent, windowMs: windowH * H, resetsAt: NOW + (windowH - elapsedH) * H });

test('pace: fração decorrida, ritmo esperado e projeção', () => {
  const p = pace(win(30, 2.5), NOW);
  assert.equal(p.frac, 0.5);
  assert.equal(p.expected, 50);
  assert.equal(p.projected, 60);
});

test('pace: sem horário de reset ou duração não há ritmo', () => {
  assert.equal(pace({ percent: 10, resetsAt: null, windowMs: 5 * H }, NOW), null);
  assert.equal(pace({ percent: 10, resetsAt: NOW + H }, NOW), null);
});

test('pace: projeção só depois de um pouco de tempo decorrido', () => {
  assert.equal(pace(win(5, 0.05), NOW).projected, null);
});

test('exhaustion: acima do ritmo, avisa o horário em que o limite acaba', () => {
  // 60% usados com metade da janela: acaba antes do reset
  const r = exhaustion(win(60, 2.5), NOW);
  assert.equal(r.reached, false);
  assert.ok(r.at > NOW && r.at < NOW + 2.5 * H, 'acaba entre agora e o reset');
  // 60% em 2,5h -> 24%/h -> faltam 40% -> ~1h40
  assert.ok(Math.abs(r.at - (NOW + (40 / 24) * H)) < 1000);
});

test('exhaustion: no ritmo certo ou abaixo, não há risco', () => {
  assert.equal(exhaustion(win(50, 2.5), NOW), null); // chega exatamente ao reset
  assert.equal(exhaustion(win(20, 2.5), NOW), null);
});

test('exhaustion: limite já atingido informa quando volta', () => {
  const w = win(100, 3);
  assert.deepEqual(exhaustion(w, NOW), { reached: true, at: w.resetsAt });
});

test('exhaustion: pouco tempo decorrido é ruído e não gera alerta falso', () => {
  assert.equal(exhaustion(win(10, 0.1), NOW), null); // 6 min
});

test('exhaustion: sem uso ou sem reset não há previsão', () => {
  assert.equal(exhaustion(win(0, 2), NOW), null);
  assert.equal(exhaustion({ percent: 80, resetsAt: null, windowMs: 5 * H }, NOW), null);
});

test('exhaustion: funciona na janela semanal', () => {
  // 70% usados com 3 dos 7 dias passados: ~23%/dia -> acaba em ~1,3 dia, antes do reset
  const r = exhaustion(win(70, 72, 168), NOW);
  assert.equal(r.reached, false);
  assert.ok(r.at - NOW > 24 * H && r.at - NOW < 48 * H);
});
