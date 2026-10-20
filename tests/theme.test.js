const test = require('node:test');
const assert = require('node:assert/strict');
const { THEMES, normalize } = require('../lib/theme');

test('os temas oferecidos são sistema, claro e escuro', () => {
  assert.deepEqual(THEMES, ['system', 'light', 'dark']);
});

test('valores válidos passam como estão', () => {
  for (const t of THEMES) assert.equal(normalize(t), t);
});

test('qualquer outra coisa vira "system" (nunca deixa o app sem tema)', () => {
  for (const bad of [undefined, null, '', 'Dark', 'DARK', 'escuro', 'auto', 0, 1, true, {}, [], ['dark']]) {
    assert.equal(normalize(bad), 'system', String(bad));
  }
});
