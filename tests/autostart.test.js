// projects/limitbar/tests/autostart.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { tmpDir, rmDir } = require('./helpers');

function withTmpConfigHome(fn) {
  const dir = tmpDir();
  const before = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  delete require.cache[require.resolve('../lib/autostart')];
  const autostart = require('../lib/autostart');
  try { fn(autostart, dir); } finally {
    if (before === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = before;
    rmDir(dir);
  }
}

test('isEnabledLinux: false quando o .desktop não existe', () => {
  withTmpConfigHome((a) => assert.equal(a.isEnabledLinux(), false));
});

test('setEnabledLinux(true): cria o .desktop com o Exec correto', () => {
  withTmpConfigHome((a) => {
    a.setEnabledLinux(true, '/opt/LimitBar/LimitBar');
    assert.equal(a.isEnabledLinux(), true);
    const text = fs.readFileSync(a.desktopFilePath(), 'utf8');
    assert.match(text, /^Exec=\/opt\/LimitBar\/LimitBar$/m);
    assert.match(text, /^Type=Application$/m);
  });
});

test('setEnabledLinux(false): remove o .desktop se existir', () => {
  withTmpConfigHome((a) => {
    a.setEnabledLinux(true, '/opt/LimitBar/LimitBar');
    a.setEnabledLinux(false);
    assert.equal(a.isEnabledLinux(), false);
  });
});

test('setEnabledLinux(false): não falha se o .desktop nunca existiu', () => {
  withTmpConfigHome((a) => assert.doesNotThrow(() => a.setEnabledLinux(false)));
});
