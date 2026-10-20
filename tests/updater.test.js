const test = require('node:test');
const assert = require('node:assert/strict');
const { mockElectron, json, fakeFetch } = require('./helpers');

const state = { version: '1.2.0', packaged: true };
const restore = mockElectron(state);
const updater = require('../updater');
restore();

const API = 'https://api.github.com/repos/igorfggomes/limitbar/releases/latest';
const DL = 'https://github.com/igorfggomes/limitbar/releases/download/v1.3.0/';
const HASH = 'a'.repeat(64);
const release = (over = {}) => ({
  tag_name: 'v1.3.0', html_url: 'https://github.com/igorfggomes/limitbar/releases/tag/v1.3.0', body: 'notas',
  assets: [{ name: 'LimitBar-win32-x64.zip', browser_download_url: DL + 'LimitBar-win32-x64.zip', size: 123, digest: 'sha256:' + HASH }],
  ...over,
});
let realFetch;
test.beforeEach(() => { realFetch = global.fetch; state.version = '1.2.0'; });
test.afterEach(() => { global.fetch = realFetch; });

test('check: versão mais nova na Release devolve os dados da atualização', async () => {
  global.fetch = fakeFetch([[API, () => json(release())]]);
  const info = await updater.check();
  assert.equal(info.version, '1.3.0');
  assert.equal(info.assetUrl, DL + 'LimitBar-win32-x64.zip');
  assert.equal(info.sha256, HASH);
  assert.equal(info.size, 123);
});

test('check: mesma versão ou mais antiga devolve null', async () => {
  global.fetch = fakeFetch([[API, () => json(release())]]);
  state.version = '1.3.0';
  assert.equal(await updater.check(), null);
  state.version = '2.0.0';
  assert.equal(await updater.check(), null);
});

test('check: sem arquivo .zip na Release, avisa mas sem link de download', async () => {
  global.fetch = fakeFetch([[API, () => json(release({ assets: [] }))]]);
  const info = await updater.check();
  assert.equal(info.version, '1.3.0');
  assert.equal(info.assetUrl, null);
  assert.equal(info.sha256, null);
});

test('check: sem "digest", usa o arquivo .sha256 publicado junto', async () => {
  const side = DL + 'LimitBar-win32-x64.zip.sha256';
  const rel = release({ assets: [
    { name: 'LimitBar-win32-x64.zip', browser_download_url: DL + 'LimitBar-win32-x64.zip', size: 1 },
    { name: 'LimitBar-win32-x64.zip.sha256', browser_download_url: side },
  ] });
  global.fetch = fakeFetch([[API, () => json(rel)], [side, () => new Response(`${'B'.repeat(64)}  LimitBar-win32-x64.zip\n`)]]);
  assert.equal((await updater.check()).sha256, 'b'.repeat(64));
});

test('check: falha ao ler o .sha256 não derruba a verificação', async () => {
  const rel = release({ assets: [
    { name: 'LimitBar-win32-x64.zip', browser_download_url: DL + 'LimitBar-win32-x64.zip', size: 1 },
    { name: 'LimitBar-win32-x64.zip.sha256', browser_download_url: DL + 'x.sha256' },
  ] });
  global.fetch = fakeFetch([[API, () => json(rel)]]); // o .sha256 cai em "fetch failed"
  assert.equal((await updater.check()).sha256, null);
});

test('check: erro do GitHub vira exceção com o código', async () => {
  global.fetch = fakeFetch([[API, () => json({}, 403)]]);
  await assert.rejects(() => updater.check(), /HTTP 403/);
});

test('download: recusa endereço que não é da Release do projeto', async () => {
  const info = { assetUrl: 'https://evil.example.com/LimitBar-win32-x64.zip', sha256: null, size: 1 };
  await assert.rejects(() => updater.download(info), /não confiável/);
  const sneaky = { assetUrl: 'https://github.com/outro/repo/releases/download/v1/a.zip', sha256: null, size: 1 };
  await assert.rejects(() => updater.download(sneaky), /não confiável/);
});

test('isNewer é exposto com a mesma regra de versões', () => {
  assert.equal(updater.isNewer('1.10.0', '1.9.0'), true);
});
