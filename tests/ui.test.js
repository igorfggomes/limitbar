const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sections = [...html.matchAll(/<details class="ps"([^>]*)>\s*<summary>([\s\S]*?)<\/summary>/g)];
// tira qualquer tag aninhada (ex. o selo de conta ativa em "Claude"), ficando só o texto do título
const titleOf = (raw) => raw.replace(/<[^>]*>/g, '').trim();

test('configurações: cada seção é um bloco recolhível com título', () => {
  assert.deepEqual(sections.map((m) => titleOf(m[2])), ['Janela', 'Aparência', 'Notificações', 'Janela de 5h', 'Claude', 'Atualizações']);
});

test('configurações: todas as seções começam recolhidas (sem o atributo "open")', () => {
  for (const m of sections) assert.doesNotMatch(m[1], /\bopen\b/, `a seção "${m[2]}" não pode vir aberta`);
});

test('configurações: não sobrou seção no formato antigo (sem recolher)', () => {
  assert.equal(html.includes('<section class="ps">'), false);
  assert.equal((html.match(/<\/details>/g) || []).length, sections.length, 'cada <details> tem seu fechamento');
});
