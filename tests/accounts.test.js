// tests/accounts.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, rmDir } = require('./helpers');
const accounts = require('../lib/accounts');
const providers = require('../providers');

let dir, credDir;
test.beforeEach(() => {
  dir = tmpDir('limitbar-accounts-');
  credDir = tmpDir('limitbar-accounts-cred-');
  process.env.CLAUDE_CONFIG_DIR = credDir;
  providers._resetForTests();
});
test.afterEach(() => { delete process.env.CLAUDE_CONFIG_DIR; rmDir(dir); rmDir(credDir); });

const creds = (rt) => ({ claudeAiOauth: { accessToken: 'AT', refreshToken: rt, expiresAt: Date.now() + 3600e3 } });

test('identify: mesmo refreshToken sempre dá o mesmo id', () => {
  assert.equal(accounts.identify(creds('RT1')), accounts.identify(creds('RT1')));
  assert.notEqual(accounts.identify(creds('RT1')), accounts.identify(creds('RT2')));
});

test('identify: sem refreshToken devolve null', () => {
  assert.equal(accounts.identify({}), null);
  assert.equal(accounts.identify({ claudeAiOauth: {} }), null);
});

test('saveProfile grava o perfil, marca como ativo e listProfiles o encontra', () => {
  const id = accounts.saveProfile(dir, 'Pessoal', creds('RT1'));
  assert.equal(accounts.readActiveId(dir), id);
  const list = accounts.listProfiles(dir);
  assert.deepEqual(list.map((p) => p.label), ['Pessoal']);
  assert.equal(list[0].id, id);
  const full = accounts.readProfile(dir, id);
  assert.equal(full.credentials.claudeAiOauth.refreshToken, 'RT1');
});

test('saveProfile sem refreshToken lança erro', () => {
  assert.throws(() => accounts.saveProfile(dir, 'X', {}));
});

test('listProfiles em pasta inexistente devolve lista vazia', () => {
  assert.deepEqual(accounts.listProfiles(path.join(dir, 'nao-existe')), []);
});

test('rename muda o apelido; falha silenciosa se o perfil não existe', () => {
  const id = accounts.saveProfile(dir, 'Pessoal', creds('RT1'));
  assert.equal(accounts.rename(dir, id, 'Trampo'), true);
  assert.equal(accounts.listProfiles(dir)[0].label, 'Trampo');
  assert.equal(accounts.rename(dir, 'id-fake', 'X'), false);
});

test('remove apaga o perfil e desmarca se era o ativo', () => {
  const id = accounts.saveProfile(dir, 'Pessoal', creds('RT1'));
  accounts.remove(dir, id);
  assert.deepEqual(accounts.listProfiles(dir), []);
  assert.equal(accounts.readActiveId(dir), null);
});

test('remove de um id que não existe não lança', () => {
  assert.doesNotThrow(() => accounts.remove(dir, 'nao-existe'));
});

test('setActiveId(dir, null) limpa a conta ativa', () => {
  const id = accounts.saveProfile(dir, 'Pessoal', creds('RT1'));
  accounts.setActiveId(dir, null);
  assert.equal(accounts.readActiveId(dir), null);
  assert.ok(accounts.readProfile(dir, id), 'o perfil continua salvo');
});

test('switchTo grava as credenciais do perfil no .credentials.json real e marca como ativo', () => {
  const id = accounts.saveProfile(dir, 'Pessoal', creds('RT1'));
  accounts.saveProfile(dir, 'Corp', creds('RT2')); // fica ativo por último
  accounts.switchTo(dir, id);
  const written = JSON.parse(fs.readFileSync(providers.credPath(), 'utf8'));
  assert.equal(written.claudeAiOauth.refreshToken, 'RT1');
  assert.equal(accounts.readActiveId(dir), id);
});

test('switchTo com id inexistente lança erro', () => {
  assert.throws(() => accounts.switchTo(dir, 'nao-existe'));
});
