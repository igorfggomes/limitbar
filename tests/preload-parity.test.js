const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// O teste de interface usa um window.api falso (tests/ui-preload.js). Se alguém criar uma função no preload
// real e esquecer a falsa, o teste de interface quebra de um jeito confuso; este teste avisa na hora.
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const names = (src) => [...src.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);

test('o window.api falso do teste de interface tem todas as funções do preload real', () => {
  const real = names(read('preload.js'));
  const fake = read('tests/ui-preload.js');
  assert.ok(real.length > 20, `esperava várias funções no preload real, achei ${real.length}`);
  const missing = real.filter((n) => !new RegExp(`\\b${n}\\b`).test(fake));
  assert.deepEqual(missing, [], `faltam no tests/ui-preload.js: ${missing.join(', ')}`);
});

test('toda função do preload real é tratada pelo processo principal (sem botão que não faz nada)', () => {
  const preload = read('preload.js');
  const main = read('main.js');
  // canais usados com ipcRenderer.send('canal') no preload precisam de ipcMain.on('canal') no main
  const channels = [...preload.matchAll(/ipcRenderer\.send\('([\w-]+)'/g)].map((m) => m[1]);
  assert.ok(channels.length >= 15, `esperava vários canais no preload, achei ${channels.length}`);
  const unhandled = channels.filter((c) => !main.includes(`ipcMain.on('${c}'`));
  assert.deepEqual(unhandled, [], `canais sem tratamento no main.js: ${unhandled.join(', ')}`);
});
