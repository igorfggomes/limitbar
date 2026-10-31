// projects/limitbar/tests/hooks-codex.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, rmDir } = require('./helpers');
const hooks = require('../lib/hooks-codex');

test('withNotifyEnabled: adiciona a linha quando não existe notify', () => {
  const { text, conflict } = hooks.withNotifyEnabled('model = "o3"\n');
  assert.equal(conflict, false);
  assert.match(text, /model = "o3"/);
  assert.match(text, /notify = \["node", ".*signal-hook\.js", "codex", "turn-complete"\]/);
});

test('withNotifyEnabled: idempotente quando já é a nossa linha', () => {
  const once = hooks.withNotifyEnabled('').text;
  const twice = hooks.withNotifyEnabled(once);
  assert.equal(twice.conflict, false);
  assert.equal(twice.text, once);
});

test('withNotifyEnabled: detecta conflito com notify de outra origem e não mexe no texto', () => {
  const original = 'notify = ["/usr/bin/outro-script.sh"]\n';
  const { text, conflict } = hooks.withNotifyEnabled(original);
  assert.equal(conflict, true);
  assert.equal(text, original);
});

test('withNotifyDisabled: remove só a nossa linha', () => {
  const withOurs = hooks.withNotifyEnabled('model = "o3"\n').text;
  const out = hooks.withNotifyDisabled(withOurs);
  assert.equal(out.includes('notify ='), false);
  assert.match(out, /model = "o3"/);
});

test('withNotifyDisabled: não mexe num notify de outra origem', () => {
  const original = 'notify = ["/usr/bin/outro-script.sh"]\n';
  assert.equal(hooks.withNotifyDisabled(original), original);
});

test('withNotifyEnabled: insere antes do primeiro [table] quando existem tabelas no arquivo', () => {
  const original = '[hooks.state]\n\n[hooks.state.\'foo:bar:0:0\']\ntrusted_hash = "x"\n';
  const { text, conflict } = hooks.withNotifyEnabled(original);
  assert.equal(conflict, false);
  assert.ok(text.indexOf('notify') < text.indexOf('['));
  assert.match(text, /\[hooks\.state\]/);
  assert.match(text, /trusted_hash = "x"/);
});

test('withNotifyDisabled: remove a linha mesmo quando inserida antes de tabelas, restaurando o original', () => {
  const original = '[hooks.state]\n\n[hooks.state.\'foo:bar:0:0\']\ntrusted_hash = "x"\n';
  const enabled = hooks.withNotifyEnabled(original).text;
  const disabled = hooks.withNotifyDisabled(enabled);
  assert.equal(disabled, original);
});

test('withNotifyEnabled: notify dentro de [table] não é conflito e a linha da tabela fica intacta', () => {
  const original = 'model = "o3"\n\n[profiles.work]\nnotify = ["/usr/bin/outro-script.sh"]\n';
  const { text, conflict } = hooks.withNotifyEnabled(original);
  assert.equal(conflict, false);
  assert.ok(text.indexOf('notify = ["node"') < text.indexOf('[profiles.work]')); // inserido antes da tabela
  assert.match(text, /\[profiles\.work\]\nnotify = \["\/usr\/bin\/outro-script\.sh"\]/); // tabela intacta
  assert.match(text, /model = "o3"/);
});

test('withNotifyDisabled: nunca remove um notify de dentro de [table]', () => {
  const original = 'model = "o3"\n\n[profiles.work]\nnotify = ["/usr/bin/outro-script.sh"]\n';
  assert.equal(hooks.withNotifyDisabled(original), original); // sem notify nosso no topo: nada muda
  const enabled = hooks.withNotifyEnabled(original).text;
  assert.equal(hooks.withNotifyDisabled(enabled), original); // remove só o nosso, no topo
});

test('setEnabled: liga, detecta conflito, desliga — num config.toml temporário', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.toml'), 'model = "o3"\n');
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  try {
    let r = hooks.setEnabled(true);
    assert.deepEqual(r, { ok: true, conflict: false });
    assert.match(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), /signal-hook\.js/);

    r = hooks.setEnabled(false);
    assert.deepEqual(r, { ok: true, conflict: false });
    assert.equal(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8').includes('notify ='), false);

    fs.writeFileSync(path.join(dir, 'config.toml'), 'notify = ["/outro"]\n');
    r = hooks.setEnabled(true);
    assert.deepEqual(r, { ok: false, conflict: true });
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    rmDir(dir);
  }
});

test('setEnabled: config.toml inexistente é criado ao ligar', () => {
  const dir = tmpDir();
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  try {
    const r = hooks.setEnabled(true);
    assert.equal(r.ok, true);
    assert.match(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), /signal-hook\.js/);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    rmDir(dir);
  }
});
