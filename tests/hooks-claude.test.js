// projects/limitbar/tests/hooks-claude.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, rmDir } = require('./helpers');
const hooks = require('../lib/hooks-claude');

test('withHookEnabled: cria o evento do zero', () => {
  const out = hooks.withHookEnabled({}, 'Stop', 'node x claude stop');
  assert.deepEqual(out, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node x claude stop' }] }] } });
});

test('withHookEnabled: preserva hooks de outras ferramentas e não duplica o nosso', () => {
  const root = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'outra-ferramenta' }] }] } };
  const once = hooks.withHookEnabled(root, 'Stop', 'node x claude stop');
  const twice = hooks.withHookEnabled(once, 'Stop', 'node x claude stop');
  assert.deepEqual(twice, once); // idempotente
  assert.equal(twice.hooks.Stop.length, 2);
  assert.ok(twice.hooks.Stop.some((g) => g.hooks[0].command === 'outra-ferramenta'));
});

test('withHookDisabled: remove só o nosso grupo, preserva o resto', () => {
  const root = { hooks: { Stop: [
    { hooks: [{ type: 'command', command: 'outra-ferramenta' }] },
    { hooks: [{ type: 'command', command: 'node x claude stop' }] },
  ] } };
  const out = hooks.withHookDisabled(root, 'Stop', 'node x claude stop');
  assert.deepEqual(out.hooks.Stop, [{ hooks: [{ type: 'command', command: 'outra-ferramenta' }] }]);
});

test('withHookDisabled: evento some do objeto quando fica vazio', () => {
  const root = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node x claude stop' }] }] } };
  const out = hooks.withHookDisabled(root, 'Stop', 'node x claude stop');
  assert.deepEqual(out, { hooks: {} });
});

test('withHookDisabled: sem hooks configurados não lança', () => {
  assert.deepEqual(hooks.withHookDisabled({}, 'Stop', 'node x claude stop'), {});
});

test('setEnabled: liga e desliga de ponta a ponta num settings.json temporário', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ outraChave: 1 }));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    hooks.setEnabled(true);
    let j = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(j.outraChave, 1); // preserva o resto do arquivo
    assert.equal(j.hooks.Stop.length, 1);
    assert.equal(j.hooks.Notification.length, 1);
    hooks.setEnabled(true); // idempotente
    j = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(j.hooks.Stop.length, 1);
    hooks.setEnabled(false);
    j = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(j.hooks.Stop, undefined);
    assert.equal(j.outraChave, 1);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
    rmDir(dir);
  }
});

test('setEnabled: settings.json inexistente é criado', () => {
  const dir = tmpDir();
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    hooks.setEnabled(true);
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(j.hooks.Stop.length, 1);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
    rmDir(dir);
  }
});
