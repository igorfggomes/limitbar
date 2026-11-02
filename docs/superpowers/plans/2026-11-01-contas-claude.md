# Troca de conta Claude (pessoal / corporativa) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o usuário trocar de conta Claude (ex. pessoal/corporativa) pelo LimitBar, regravando `~/.claude/.credentials.json` com um perfil salvo, para que a próxima chamada da CLI já use a conta escolhida.

**Architecture:** Um módulo novo `lib/accounts.js` (sem Electron, testável isolado, mesmo padrão de `lib/alerts.js`) guarda perfis (snapshots do `.credentials.json`) em arquivos JSON numa pasta própria e expõe `switchTo()`, que reutiliza `writeAtomic`/`credPath` já existentes em `providers.js`. `main.js` liga isso à UI: detecta login novo comparando o `refreshToken` atual com os perfis salvos, expõe IPC para listar/trocar/renomear/remover/salvar, e mostra um rótulo clicável na faixa (`dock.html`) com um menu nativo de contas.

**Tech Stack:** Node.js (CommonJS), Electron (`main.js`/`preload.js`/`dock.html`/`index.html`), `node:test` + `node:assert/strict` para testes (`tests/*.test.js`, helpers em `tests/helpers.js`).

## Global Constraints

- Node 18+, sem dependências novas de `npm` (tudo com `fs`/`path`/`crypto` nativos).
- Testes rodam com `node scripts/test.js` (script já existente do projeto).
- Segue os padrões de arquivo já estabelecidos: módulos em `lib/` não dependem de `electron`; `main.js` é quem integra com Electron; `preload.js` só expõe `ipcRenderer.send`/`on`.
- Textos de interface em português, no mesmo tom direto já usado no resto do app (ver `README.md`, `lib/alerts.js`).
- Rótulos de conta: `String(label || '...').trim().slice(0, 40)` em qualquer entrada vinda da UI (mesmo teto usado em outros campos de texto livres do projeto, evita nomes absurdamente longos quebrando o layout da faixa).

---

### Task 1: `lib/accounts.js` — armazenamento de perfis

**Files:**
- Create: `lib/accounts.js`
- Test: `tests/accounts.test.js`

**Interfaces:**
- Produces:
  - `hashId(refreshToken: string): string` — hash estável de 12 chars hex.
  - `identify(credentialsJson: object): string|null` — extrai `claudeAiOauth.refreshToken` e devolve o `id`, ou `null` se não houver.
  - `listProfiles(dir: string): Array<{id, label, savedAt}>` — ordenado por `label` (pt-BR).
  - `readProfile(dir: string, id: string): {id, label, savedAt, credentials}|null`
  - `readActiveId(dir: string): string|null`
  - `setActiveId(dir: string, id: string|null): void`
  - `saveProfile(dir: string, label: string, credentialsJson: object): string` — grava o perfil, marca como ativo, devolve o `id`. Lança erro se `credentialsJson` não tiver `refreshToken`.
  - `rename(dir: string, id: string, label: string): boolean` — `false` se o perfil não existe.
  - `remove(dir: string, id: string): void` — idempotente; se era o ativo, desmarca.

- [ ] **Step 1: Escrever os testes**

```js
// tests/accounts.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, rmDir } = require('./helpers');
const accounts = require('../lib/accounts');

let dir;
test.beforeEach(() => { dir = tmpDir('limitbar-accounts-'); });
test.afterEach(() => rmDir(dir));

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
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test tests/accounts.test.js`
Expected: FAIL com `Cannot find module '../lib/accounts'`

- [ ] **Step 3: Implementar `lib/accounts.js`**

```js
// lib/accounts.js
// Perfis de conta Claude: snapshots de .credentials.json com apelido, para trocar a conta
// ativa sem logout/login manual. Sem dependência do Electron — testável isolado.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const hashId = (refreshToken) => crypto.createHash('sha256').update(String(refreshToken)).digest('hex').slice(0, 12);

function identify(credentialsJson) {
  const rt = credentialsJson && credentialsJson.claudeAiOauth && credentialsJson.claudeAiOauth.refreshToken;
  return rt ? hashId(rt) : null;
}

const profileFile = (dir, id) => path.join(dir, `${id}.json`);
const activeFile = (dir) => path.join(dir, 'active.json');
const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

function readProfile(dir, id) {
  try { return JSON.parse(fs.readFileSync(profileFile(dir, id), 'utf8')); } catch { return null; }
}

function listProfiles(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (n === 'active.json' || !n.endsWith('.json')) continue;
    const p = readProfile(dir, n.slice(0, -5));
    if (p && p.id) out.push({ id: p.id, label: p.label, savedAt: p.savedAt });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

function readActiveId(dir) {
  try { return JSON.parse(fs.readFileSync(activeFile(dir), 'utf8')).id || null; } catch { return null; }
}

function setActiveId(dir, id) {
  ensureDir(dir);
  fs.writeFileSync(activeFile(dir), JSON.stringify({ id: id || null }));
}

function saveProfile(dir, label, credentialsJson) {
  const id = identify(credentialsJson);
  if (!id) throw new Error('credenciais sem refreshToken');
  ensureDir(dir);
  fs.writeFileSync(profileFile(dir, id), JSON.stringify({ id, label: String(label || 'Conta').trim().slice(0, 40) || 'Conta', savedAt: Date.now(), credentials: credentialsJson }));
  setActiveId(dir, id);
  return id;
}

function rename(dir, id, label) {
  const p = readProfile(dir, id);
  if (!p) return false;
  p.label = String(label || p.label).trim().slice(0, 40) || p.label;
  fs.writeFileSync(profileFile(dir, id), JSON.stringify(p));
  return true;
}

function remove(dir, id) {
  try { fs.unlinkSync(profileFile(dir, id)); } catch { /* já não existe */ }
  if (readActiveId(dir) === id) setActiveId(dir, null);
}

module.exports = { hashId, identify, listProfiles, readProfile, readActiveId, setActiveId, saveProfile, rename, remove };
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test tests/accounts.test.js`
Expected: PASS (10 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/accounts.js tests/accounts.test.js
git commit -m "feat(limitbar): armazenamento de perfis de conta Claude"
```

---

### Task 2: trocar a conta ativa (`switchTo`) + expor utilitários de `providers.js`

**Files:**
- Modify: `providers.js` (exportar `writeAtomic`, `credPath`, `invalidateCache`, `isRefreshing`)
- Modify: `lib/accounts.js` (adicionar `switchTo`)
- Test: `tests/accounts.test.js` (adicionar casos), `tests/providers.claude.test.js` (adicionar casos)

**Interfaces:**
- Consumes de `providers.js`: as funções já existentes `writeAtomic(file, text)` e a const `credPath()` (ambas já implementadas em `providers.js:69-78`, só precisam ser exportadas).
- Produces:
  - `providers.writeAtomic(file: string, text: string): void`
  - `providers.credPath(): string`
  - `providers.invalidateCache(): void` — zera `claudeCache`, forçando a próxima `providers.claude()` a consultar a rede.
  - `providers.isRefreshing(): boolean` — `true` enquanto uma renovação de token está em andamento.
  - `accounts.switchTo(dir: string, id: string): void` — lê o perfil, grava as credenciais no `.credentials.json` real (via `providers.writeAtomic`/`providers.credPath`), marca como ativo e invalida o cache de uso. Lança erro se o perfil não existe.

- [ ] **Step 1: Escrever os testes (providers.js)**

Adicionar ao final de `tests/providers.claude.test.js` (reaproveita `dir`/`writeCreds`/`readCreds`/`credFile` já definidos no `beforeEach` do arquivo):

```js
test('credPath aponta para o arquivo de credenciais do CLAUDE_CONFIG_DIR atual', () => {
  assert.equal(providers.credPath(), credFile());
});

test('writeAtomic grava o conteúdo trocando o arquivo de uma vez', () => {
  providers.writeAtomic(credFile(), JSON.stringify({ a: 1 }));
  assert.deepEqual(readCreds(), { a: 1 });
});

test('invalidateCache força nova consulta na próxima leitura', async () => {
  writeCreds();
  global.fetch = fakeFetch([[USAGE, usageFor('AT1')]]);
  await providers.claude();
  assert.equal(global.fetch.count(USAGE), 1);
  providers.invalidateCache();
  await providers.claude();
  assert.equal(global.fetch.count(USAGE), 2, 'releu em vez de usar o cache');
});

test('isRefreshing fica true durante a renovação e false depois', async () => {
  writeCreds({ expiresAt: Date.now() - 1000 });
  let sawTrue = false;
  global.fetch = fakeFetch([
    [TOKEN, async (_u, init) => { sawTrue = providers.isRefreshing(); return json({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }); }],
    [USAGE, usageFor('AT2')],
  ]);
  await providers.claude();
  assert.equal(sawTrue, true);
  assert.equal(providers.isRefreshing(), false);
});
```

- [ ] **Step 2: Escrever os testes (accounts.js — switchTo)**

Adicionar a `tests/accounts.test.js`:

```js
const path = require('path'); // já importado no topo do arquivo, confirmar que está presente
const providers = require('../providers');

test.beforeEach(() => {
  dir = tmpDir('limitbar-accounts-');
  credDir = tmpDir('limitbar-accounts-cred-');
  process.env.CLAUDE_CONFIG_DIR = credDir;
  providers._resetForTests();
});
test.afterEach(() => { delete process.env.CLAUDE_CONFIG_DIR; rmDir(dir); rmDir(credDir); });

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
```

Nota: isso substitui o `beforeEach`/`afterEach` já escritos na Task 1 por versões que também preparam `CLAUDE_CONFIG_DIR` — ajuste o arquivo para ter só um par `beforeEach`/`afterEach` (o de cima), já que `dir` e `credDir` cobrem os dois usos.

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `node --test tests/providers.claude.test.js tests/accounts.test.js`
Expected: FAIL — `providers.writeAtomic is not a function` / `providers.credPath is not a function` / `accounts.switchTo is not a function`

- [ ] **Step 4: Exportar os utilitários em `providers.js`**

No final de `providers.js`, trocar:

```js
module.exports = { claude, codex, configure, ProviderError, _resetForTests };
```

por:

```js
module.exports = {
  claude, codex, configure, ProviderError, _resetForTests,
  writeAtomic, credPath, invalidateCache: () => { claudeCache = null; }, isRefreshing: () => !!refreshing,
};
```

(`writeAtomic`, `credPath` e a variável `refreshing` já existem no arquivo — ver `providers.js:69-78` e `providers.js:88`.)

- [ ] **Step 5: Implementar `switchTo` em `lib/accounts.js`**

Adicionar ao topo do arquivo (depois dos outros `require`s):

```js
const providers = require('../providers');
```

E ao final, antes do `module.exports`:

```js
function switchTo(dir, id) {
  const p = readProfile(dir, id);
  if (!p) throw new Error('conta não encontrada');
  providers.writeAtomic(providers.credPath(), JSON.stringify(p.credentials));
  setActiveId(dir, id);
  providers.invalidateCache();
}
```

Atualizar o `module.exports` para incluir `switchTo`.

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `node --test tests/providers.claude.test.js tests/accounts.test.js`
Expected: PASS (todos os testes das duas tasks)

- [ ] **Step 7: Rodar a suíte inteira (garantir que nada quebrou)**

Run: `node scripts/test.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add providers.js lib/accounts.js tests/accounts.test.js tests/providers.claude.test.js
git commit -m "feat(limitbar): troca de conta regrava as credenciais ativas do Claude"
```

---

### Task 3: integração no `main.js` — detecção de login novo e IPC de contas

**Files:**
- Modify: `main.js`

**Interfaces:**
- Consumes: `accounts.listProfiles/readProfile/readActiveId/setActiveId/saveProfile/rename/remove/switchTo/identify` (Task 1/2), `providers.credPath/isRefreshing` (Task 2).
- Produces (para a UI, via `preload.js` na Task 4):
  - IPC `accounts-switch` (payload: `id: string`)
  - IPC `accounts-rename` (payload: `{ id: string, label: string }`)
  - IPC `accounts-remove` (payload: `id: string`)
  - IPC `accounts-save-current` (payload: `label: string`)
  - IPC `accounts-menu` (sem payload) — abre o menu nativo de contas, popup no `dock`
  - `sendSettings()` passa a incluir `accounts: { list: [{id,label,active}], hasUnknownLogin: boolean }` no objeto enviado pelo canal `settings`
  - Canal `accounts` enviado ao `dock` (mesmo payload de `accounts` acima) toda vez que `sendSettings()` roda

Não há testes automatizados para este arquivo (o projeto não testa `main.js` diretamente — ver `tests/ui-smoke.js`/`tests/dock-smoke.js`, que sobem o app de verdade; cobertura de lógica fica nos módulos de `lib/`, já testados nas Tasks 1-2). A verificação deste task é manual (Step final) e via `node scripts/test.js` para garantir que nada quebrou.

- [ ] **Step 1: Importar o módulo e criar o helper de diretório**

No topo de `main.js`, junto aos outros `require`s:

```js
const accountsLib = require('./lib/accounts');
```

Perto da definição de `file`/`readJson`/`writeJson` (main.js:28-30), adicionar:

```js
const accountsDir = () => path.join(app.getPath('userData'), 'claude-accounts');
```

- [ ] **Step 2: Estado em memória para não repetir o aviso de login novo**

Junto às outras variáveis globais de estado (main.js:17, onde está `let win, dock, last = null, ...`), adicionar à mesma linha ou logo abaixo:

```js
const notifiedUnknownLogins = new Set();
```

- [ ] **Step 3: Função de detecção de login novo**

Adicionar após a função `refresh()` (depois de `main.js:65`, fechamento da função `refresh`):

```js
// Compara o login atual do Claude com os perfis salvos: se mudou pra uma conta já conhecida,
// só acompanha; se é desconhecida, avisa uma vez (por sessão do app) pra oferecer salvar.
function checkAccountLogin() {
  let creds;
  try { creds = JSON.parse(fs.readFileSync(providers.credPath(), 'utf8')); } catch { return; }
  const id = accountsLib.identify(creds);
  if (!id) return;
  const dir = accountsDir();
  if (accountsLib.readProfile(dir, id)) {
    if (accountsLib.readActiveId(dir) !== id) { accountsLib.setActiveId(dir, id); sendSettings(); }
    return;
  }
  if (notifiedUnknownLogins.has(id)) return;
  notifiedUnknownLogins.add(id);
  notify('Login novo do Claude detectado', 'Clique para abrir o LimitBar e salvar esta conta.');
}
```

- [ ] **Step 4: Chamar a detecção a cada ciclo de atualização**

Em `refresh()` (main.js:49-65), logo após a linha `if (!claude) [claude, codex] = await Promise.all([providers.claude(), providers.codex()]);`, adicionar:

```js
  checkAccountLogin();
```

(fica dentro de `refresh()`, que já roda a cada `REFRESH_MS` via `timers.push(setInterval(refresh, REFRESH_MS))` em `main.js:415`, e também na primeira chamada manual.)

- [ ] **Step 5: Incluir as contas em `sendSettings()`**

Em `sendSettings()` (main.js:159-166), adicionar ao objeto enviado:

```js
function sendSettings() {
  if (!alive(win)) return;
  const dir = accountsDir();
  const activeId = accountsLib.readActiveId(dir);
  const accountsPayload = { list: accountsLib.listProfiles(dir).map((p) => ({ ...p, active: p.id === activeId })), hasUnknownLogin: false };
  win.webContents.send('settings', {
    closeToTray: settings.closeToTray, autoUpdate: settings.autoUpdate, autoRefreshToken: settings.autoRefreshToken,
    theme: settings.theme, alerts: settings.alerts, onboarded: !!settings.onboarded, openAtLogin: app.getLoginItemSettings().openAtLogin,
    keepAlive: { cfg: settings.keepAlive, status: keepAlive ? keepAlive.status() : null, testing: testingKeepAlive },
    lastCheck: lastCheckAt, version: app.getVersion(), maxHeight: maxPanelHeight(),
    accounts: accountsPayload,
  });
  if (alive(dock)) dock.webContents.send('accounts', accountsPayload);
}
```

(`hasUnknownLogin` fica reservado para uma melhoria futura de mostrar isso na UI do painel também; por ora o aviso é só a notificação do Step 3 — não remover o campo, a Task 5 não depende dele mas mantém a forma do payload estável.)

- [ ] **Step 6: Funções de ação (trocar/renomear/remover/salvar)**

Adicionar perto de `setAutoRefreshToken`/`setTheme` (main.js, logo após a função `setTheme`):

```js
function accountsSwitch(id) {
  if (providers.isRefreshing()) return; // evita trocar o arquivo no meio de uma renovação de token
  try { accountsLib.switchTo(accountsDir(), id); } catch { /* perfil removido nesse meio tempo */ }
  sendSettings();
  refresh();
}

function accountsRename(id, label) {
  accountsLib.rename(accountsDir(), id, label);
  sendSettings();
}

function accountsRemove(id) {
  accountsLib.remove(accountsDir(), id);
  sendSettings();
}

function accountsSaveCurrent(label) {
  let creds;
  try { creds = JSON.parse(fs.readFileSync(providers.credPath(), 'utf8')); } catch { return; }
  try { accountsLib.saveProfile(accountsDir(), label, creds); } catch { /* sem refreshToken: nada a salvar */ }
  notifiedUnknownLogins.delete(accountsLib.identify(creds));
  sendSettings();
}

function showAccountsMenu() {
  const dir = accountsDir();
  const list = accountsLib.listProfiles(dir);
  const activeId = accountsLib.readActiveId(dir);
  if (!list.length) { openFlyout(); return; } // nada salvo ainda: manda direto pro painel
  Menu.buildFromTemplate([
    ...list.map((p) => ({
      label: p.label, type: 'radio', checked: p.id === activeId,
      click: () => accountsSwitch(p.id),
    })),
    { type: 'separator' },
    { label: 'Gerenciar contas...', click: openFlyout },
  ]).popup({ window: dock });
}
```

- [ ] **Step 7: Registrar os canais IPC**

Junto aos outros `ipcMain.on` (main.js:360-376), adicionar:

```js
  ipcMain.on('accounts-switch', (_e, id) => accountsSwitch(id));
  ipcMain.on('accounts-rename', (_e, { id, label } = {}) => accountsRename(id, label));
  ipcMain.on('accounts-remove', (_e, id) => accountsRemove(id));
  ipcMain.on('accounts-save-current', (_e, label) => accountsSaveCurrent(label));
  ipcMain.on('accounts-menu', showAccountsMenu);
```

- [ ] **Step 8: Rodar a suíte para garantir que nada quebrou**

Run: `node scripts/test.js`
Expected: PASS

- [ ] **Step 9: Verificação manual**

Run: `npm start` (define `LIMITBAR_USER_DATA` para uma pasta de teste se quiser isolar do perfil real, ex. `LIMITBAR_USER_DATA=%TEMP%\\limitbar-dev npm start` no PowerShell).
Confirmar no painel que abre sem erros no console (DevTools não abre por padrão; checar o terminal onde rodou `npm start`). Como ainda não há UI (Task 4/5), a verificação aqui é só "o app sobe sem lançar exceção" — a função `checkAccountLogin` e os handlers IPC ficam cobertos de fato pela verificação manual da Task 5.

- [ ] **Step 10: Commit**

```bash
git add main.js
git commit -m "feat(limitbar): detecta login novo do Claude e liga os perfis de conta ao app"
```

---

### Task 4: `preload.js` + rótulo de conta na faixa (`dock.html`)

**Files:**
- Modify: `preload.js`
- Modify: `dock.html`

**Interfaces:**
- Consumes: canais IPC da Task 3 (`accounts-switch`, `accounts-rename`, `accounts-remove`, `accounts-save-current`, `accounts-menu`, canal `accounts` enviado ao `dock`).
- Produces: `window.api.accountsSwitch(id)`, `accountsRename(id, label)`, `accountsRemove(id)`, `accountsSaveCurrent(label)`, `accountsMenu()`, `onAccounts(cb)` — usados pela Task 5.

- [ ] **Step 1: Expor os canais em `preload.js`**

Em `preload.js`, dentro do objeto passado a `contextBridge.exposeInMainWorld('api', {...})`, adicionar:

```js
  accountsSwitch: (id) => ipcRenderer.send('accounts-switch', id),
  accountsRename: (id, label) => ipcRenderer.send('accounts-rename', { id, label }),
  accountsRemove: (id) => ipcRenderer.send('accounts-remove', id),
  accountsSaveCurrent: (label) => ipcRenderer.send('accounts-save-current', label),
  accountsMenu: () => ipcRenderer.send('accounts-menu'),
  onAccounts: (cb) => ipcRenderer.on('accounts', (_e, a) => cb(a)),
```

- [ ] **Step 2: Rodar o teste de paridade do preload**

Run: `node --test tests/preload-parity.test.js`
Expected: PASS (confirma que `preload.js` e os mocks de teste continuam alinhados — se esse teste listar os canais manualmente, ajustar a lista conforme o que ele pedir)

- [ ] **Step 3: Mostrar o rótulo da conta ativa na faixa**

Em `dock.html`, no HTML do `#bar` (linha 39), adicionar um span antes do `#v`:

```html
<div id="bar"><span id="grip" title="Arrastar">⋮⋮</span><span id="up" title="Atualização disponível" style="display:none">⬆</span><span id="acct" title="Trocar de conta" style="display:none"></span><span id="v" title="Abrir detalhes"></span></div>
```

Adicionar um estilo simples perto dos outros no `<style>` (junto a `.sep`):

```css
#acct { -webkit-app-region: no-drag; cursor: pointer; color: #a1a1aa; font-size: 11px; padding: 0 2px; border-radius: 6px; }
#acct:hover { background: rgba(255,255,255,.10); color: #fff; }
```

No `<script>`, após a linha `const NAME = { claude: 'Claude', codex: 'Codex' };`, adicionar o handler do canal novo:

```js
window.api.onAccounts((a) => {
  const el = document.getElementById('acct');
  const active = (a.list || []).find((p) => p.active);
  el.style.display = (a.list || []).length ? '' : 'none';
  el.textContent = active ? esc(active.label) : '?';
  window.api.dockResize(document.getElementById('bar').offsetWidth + 2);
});
document.getElementById('acct').onclick = (e) => { e.stopPropagation(); window.api.accountsMenu(); };
```

(`e.stopPropagation()` evita que o clique também dispare o `onclick` do `#v`/toggle do painel, já que os dois elementos ficam lado a lado dentro do mesmo `#bar`.)

- [ ] **Step 4: Rodar a suíte para garantir que nada quebrou**

Run: `node scripts/test.js`
Expected: PASS

- [ ] **Step 5: Verificação manual**

Run: `npm start`. Sem nenhum perfil salvo ainda, o rótulo não deve aparecer na faixa (`display:none`). Isso só muda de verdade depois da Task 5, quando dá pra salvar o primeiro perfil pela UI — nesta task, confirmar apenas que a faixa continua exibindo Claude/Codex normalmente e sem erros no console.

- [ ] **Step 6: Commit**

```bash
git add preload.js dock.html
git commit -m "feat(limitbar): rótulo de conta ativa clicável na faixa"
```

---

### Task 5: configurações (`index.html`) — listar, renomear, remover, salvar

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `window.api.accountsSwitch/accountsRename/accountsRemove/accountsSaveCurrent` (Task 4), `s.accounts.list` recebido em `window.api.onSettings` (Task 3: `{ id, label, active }[]`).

- [ ] **Step 1: Marcação HTML dentro da seção "Claude"**

Em `index.html`, dentro do `<details class="ps">` da seção Claude (linhas 262-270), adicionar depois do `<label class="opt">` de "Renovar o login sozinho":

```html
      <div class="opt col">
        <b>Contas salvas</b>
        <small>Troque entre contas (ex. pessoal e corporativa) sem logar de novo no terminal.</small>
        <div id="acct-list"></div>
        <div class="opt">
          <input type="text" id="acct-label" placeholder="Apelido da conta atual" maxlength="40" style="flex:1">
          <button class="act" id="acct-save">Salvar conta atual</button>
        </div>
      </div>
```

- [ ] **Step 2: Função de renderização**

Perto de `renderKA` (index.html:528-550), adicionar:

```js
function renderAccounts(a) {
  const box = $('acct-list');
  box.innerHTML = '';
  const list = (a && a.list) || [];
  if (!list.length) {
    const p = document.createElement('small');
    p.textContent = 'Nenhuma conta salva ainda.';
    box.appendChild(p);
    return;
  }
  list.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'opt';
    row.innerHTML = `
      <span><b>${esc(p.label)}</b>${p.active ? '<small>ativa agora</small>' : ''}</span>
      <button class="act" data-act="switch" data-id="${p.id}" ${p.active ? 'disabled' : ''}>Usar</button>
      <button class="act" data-act="rename" data-id="${p.id}">Renomear</button>
      <button class="act" data-act="remove" data-id="${p.id}">Remover</button>
    `;
    box.appendChild(row);
  });
}
```

Confirmar que já existe uma função `esc()` acessível neste escopo (há uma em `dock.html`; em `index.html`, procurar se já existe uma equivalente — se não existir, adicionar logo antes de `renderAccounts`):

```js
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
```

(Só adicionar se uma busca por `function esc\|const esc` em `index.html` não encontrar nada — não duplicar o nome se já existir.)

- [ ] **Step 3: Ligar a renderização ao `onSettings` e os cliques aos handlers**

Em `window.api.onSettings((s) => { ... })` (index.html:551-568), adicionar:

```js
  renderAccounts(s.accounts);
```

Perto dos outros listeners de clique (index.html:581-604), adicionar:

```js
$('acct-list').onclick = (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  if (act === 'switch') window.api.accountsSwitch(id);
  else if (act === 'remove') { if (confirm('Remover esta conta salva?')) window.api.accountsRemove(id); }
  else if (act === 'rename') {
    const novo = prompt('Novo apelido:');
    if (novo && novo.trim()) window.api.accountsRename(id, novo.trim());
  }
};
$('acct-save').onclick = () => {
  const el = $('acct-label');
  const label = el.value.trim();
  if (!label) { el.focus(); return; }
  window.api.accountsSaveCurrent(label);
  el.value = '';
};
```

- [ ] **Step 4: Rodar a suíte para garantir que nada quebrou**

Run: `node scripts/test.js`
Expected: PASS

- [ ] **Step 5: Verificação manual ponta a ponta**

Run: `LIMITBAR_USER_DATA` apontando para uma pasta de teste e `CLAUDE_CONFIG_DIR` apontando para um `.credentials.json` de teste (ou use a conta real, com cuidado), depois `npm start`:
1. Abrir ⚙ → Claude: deve aparecer "Nenhuma conta salva ainda."
2. Digitar um apelido (ex. "Pessoal") e clicar "Salvar conta atual": a lista deve mostrar a conta como ativa, e o rótulo deve aparecer na faixa (Task 4).
3. Trocar `CLAUDE_CONFIG_DIR`/o conteúdo do arquivo para simular uma segunda conta (outro `refreshToken`), reabrir o app: deve chegar uma notificação do Windows "Login novo do Claude detectado".
4. Salvar a segunda conta com outro apelido; confirmar que "Usar" na primeira conta regrava o `.credentials.json` com o `refreshToken` dela (checar o conteúdo do arquivo).
5. Renomear e remover uma conta pela lista; confirmar que a lista e o rótulo da faixa atualizam.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(limitbar): interface de contas salvas nas configurações do Claude"
```
