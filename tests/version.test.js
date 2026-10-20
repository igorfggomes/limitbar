const test = require('node:test');
const assert = require('node:assert/strict');
const { isNewer } = require('../lib/version');

test('compara versões numericamente, não como texto', () => {
  assert.equal(isNewer('1.2.0', '1.1.0'), true);
  assert.equal(isNewer('1.10.0', '1.9.0'), true);
  assert.equal(isNewer('2.0.0', '1.9.9'), true);
  assert.equal(isNewer('1.1.1', '1.1.0'), true);
});

test('igual ou mais antiga não é atualização', () => {
  assert.equal(isNewer('1.1.0', '1.1.0'), false);
  assert.equal(isNewer('1.0.9', '1.1.0'), false);
  assert.equal(isNewer('0.9.0', '1.0.0'), false);
});

test('aceita prefixo "v" e ignora sufixo de pré-lançamento', () => {
  assert.equal(isNewer('v1.3.0', '1.2.0'), true);
  assert.equal(isNewer('1.1.0-beta', '1.1.0'), false);
  assert.equal(isNewer('v1.1.0', 'v1.1.0'), false);
});

test('versões incompletas ou inválidas não quebram', () => {
  assert.equal(isNewer('1.2', '1.1.9'), true);
  assert.equal(isNewer('abc', '1.0.0'), false);
  assert.equal(isNewer('', '1.0.0'), false);
});
