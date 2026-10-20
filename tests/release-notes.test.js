const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { extract } = require('../scripts/release-notes');

const LOG = `# Changelog

## 1.3.0 — 2026-10-20

### Novidades
- alertas configuráveis

## 1.2.0 — 2026-10-19
- atualização automática

## 1.0.0
- primeira versão
`;

test('extrai só a seção da versão pedida', () => {
  const n = extract(LOG, '1.3.0');
  assert.match(n, /alertas configuráveis/);
  assert.doesNotMatch(n, /atualização automática/);
  assert.doesNotMatch(n, /^## /m, 'não inclui o título de outra versão');
});

test('aceita o prefixo "v" (como na tag do git)', () => {
  assert.match(extract(LOG, 'v1.2.0'), /atualização automática/);
});

test('funciona na última seção e em título sem data', () => {
  assert.equal(extract(LOG, '1.0.0'), '- primeira versão');
});

test('versão inexistente devolve null; 1.3 não confunde com 1.3.0', () => {
  assert.equal(extract(LOG, '9.9.9'), null);
  assert.equal(extract(LOG, '1.3'), null);
});

test('aceita quebras de linha do Windows', () => {
  assert.match(extract(LOG.replace(/\n/g, '\r\n'), '1.3.0'), /alertas/);
});

test('o CHANGELOG real tem uma seção para a versão do package.json', () => {
  const root = path.join(__dirname, '..');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const notes = extract(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
  assert.ok(notes, `CHANGELOG.md precisa de uma seção "## ${version}" — o fluxo de Release usa isso`);
});
