# Alerta sonoro de fim de execução / decisão pendente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao LimitBar um alerta sonoro liga/desliga (por serviço) para quando o Claude Code ou o Codex terminam de responder ou ficam esperando uma decisão do usuário.

**Architecture:** Um script Node standalone (`lib/signal-hook.js`, sem Electron) é registrado como hook do Claude Code (`Stop`/`Notification`) e `notify` do Codex; ele grava eventos em `events.log`. O processo principal do LimitBar observa esse arquivo com `fs.watch` e toca o som/mostra o toast já usado em `notify()`. A edição dos arquivos de configuração do Claude/Codex é feita por módulos puros e testáveis (`lib/hooks-claude.js`, `lib/hooks-codex.js`) que recebem o conteúdo atual e devolvem o novo, sem acoplar a lógica de merge a I/O.

**Tech Stack:** Node.js (sem dependências novas), Electron (`Notification`, `fs.watch`), `node:test` (mesmo runner dos testes existentes).

## Global Constraints

- Sem dependências novas no `package.json` (o projeto não usa parser de TOML nem de JSON além do nativo — edição do `config.toml` do Codex é feita por manipulação de texto, não parsing completo).
- Seguir o padrão de `CLAUDE_CONFIG_DIR`/`CODEX_HOME` já usado em `providers.js` para localizar os arquivos de configuração das CLIs.
- Escrita atômica (escreve em arquivo temporário e renomeia) em qualquer arquivo de configuração externo que o LimitBar edite — mesmo cuidado hoje aplicado ao `.credentials.json` em `providers.js`.
- Desligado por padrão (`enabled: false`), igual ao `keepAlive`.
- Testes em `node:test`/`node:assert/strict`, arquivos pequenos (um por módulo), sem mocks de bibliotecas externas — usar diretórios temporários reais (`tests/helpers.js#tmpDir`).
- Português nas strings visíveis ao usuário (títulos de notificação, labels de UI), consistente com o resto do app.

---

### Task 1: `lib/signals.js` — configuração e leitura incremental de eventos

**Files:**
- Create: `projects/limitbar/lib/signals.js`
- Test: `projects/limitbar/tests/signals.test.js`

**Interfaces:**
- Produces:
  - `normalizeConfig(a) -> { enabled: boolean, services: { claude: boolean, codex: boolean } }`
  - `DEFAULTS = { enabled: false, services: { claude: true, codex: true } }`
  - `eventsDir() -> string` (resolve `LIMITBAR_EVENTS_DIR` ou `%LOCALAPPDATA%\LimitBar`)
  - `eventsFile() -> string` (`path.join(eventsDir(), 'events.log')`)
  - `parseLines(text) -> Array<{svc, kind, ts}>` (linhas JSON válidas, ignora linhas vazias/cortadas/JSON inválido)
  - `readNew(filePath, offset) -> { events, offset }` (lê só os bytes novos desde `offset`, devolve eventos completos e o novo offset; nunca lança)

- [ ] **Step 1: Write the failing test**

```js
// projects/limitbar/tests/signals.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, rmDir } = require('./helpers');
const signals = require('../lib/signals');

test('normalizeConfig: padrão desligado, serviços ligados', () => {
  assert.deepEqual(signals.normalizeConfig({}), { enabled: false, services: { claude: true, codex: true } });
  assert.deepEqual(signals.normalizeConfig(undefined), signals.DEFAULTS);
});

test('normalizeConfig: só "true" explícito liga', () => {
  assert.equal(signals.normalizeConfig({ enabled: true }).enabled, true);
  assert.equal(signals.normalizeConfig({ enabled: 1 }).enabled, false);
});

test('normalizeConfig: serviço silenciado individualmente', () => {
  assert.deepEqual(signals.normalizeConfig({ services: { claude: false } }).services, { claude: false, codex: true });
});

test('parseLines: ignora linhas vazias e JSON inválido', () => {
  const out = signals.parseLines('{"svc":"claude","kind":"stop","ts":1}\n\n{quebrado\n{"svc":"codex","kind":"turn-complete","ts":2}\n');
  assert.deepEqual(out, [{ svc: 'claude', kind: 'stop', ts: 1 }, { svc: 'codex', kind: 'turn-complete', ts: 2 }]);
});

test('readNew: lê só o que foi adicionado depois do offset', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'events.log');
  fs.writeFileSync(file, '{"svc":"claude","kind":"stop","ts":1}\n');
  const first = signals.readNew(file, 0);
  assert.equal(first.events.length, 1);
  fs.appendFileSync(file, '{"svc":"claude","kind":"notification","ts":2}\n');
  const second = signals.readNew(file, first.offset);
  assert.deepEqual(second.events, [{ svc: 'claude', kind: 'notification', ts: 2 }]);
  rmDir(dir);
});

test('readNew: arquivo inexistente não lança, offset fica 0', () => {
  const r = signals.readNew(path.join(require('os').tmpdir(), 'nao-existe-' + Date.now() + '.log'), 0);
  assert.deepEqual(r, { events: [], offset: 0 });
});

test('readNew: arquivo truncado externamente (offset maior que o tamanho) relê do início', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'events.log');
  fs.writeFileSync(file, '{"svc":"codex","kind":"turn-complete","ts":3}\n');
  const r = signals.readNew(file, 999999);
  assert.equal(r.events.length, 1);
  rmDir(dir);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/signals.test.js`
Expected: FAIL (`Cannot find module '../lib/signals'`)

- [ ] **Step 3: Write minimal implementation**

```js
// projects/limitbar/lib/signals.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = { enabled: false, services: { claude: true, codex: true } };

function normalizeConfig(a) {
  a = a && typeof a === 'object' ? a : {};
  const s = a.services && typeof a.services === 'object' ? a.services : {};
  return { enabled: a.enabled === true, services: { claude: s.claude !== false, codex: s.codex !== false } };
}

function eventsDir() {
  return process.env.LIMITBAR_EVENTS_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'LimitBar');
}
const eventsFile = () => path.join(eventsDir(), 'events.log');

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const j = JSON.parse(t);
      if (j && typeof j.svc === 'string' && typeof j.kind === 'string' && typeof j.ts === 'number') out.push({ svc: j.svc, kind: j.kind, ts: j.ts });
    } catch { /* linha cortada ou inválida: ignora */ }
  }
  return out;
}

function readNew(filePath, offset) {
  let size;
  try { size = fs.statSync(filePath).size; } catch { return { events: [], offset: 0 }; }
  const from = offset > size ? 0 : offset; // arquivo foi truncado/rotacionado: relê do início
  if (from >= size) return { events: [], offset: size };
  const fd = fs.openSync(filePath, 'r');
  const len = size - from;
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, from);
  fs.closeSync(fd);
  const text = buf.toString('utf8');
  const lastNl = text.lastIndexOf('\n');
  if (lastNl === -1) return { events: [], offset: from }; // linha ainda incompleta: espera a próxima leitura
  return { events: parseLines(text.slice(0, lastNl + 1)), offset: from + lastNl + 1 };
}

module.exports = { normalizeConfig, DEFAULTS, eventsDir, eventsFile, parseLines, readNew };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/signals.test.js`
Expected: PASS (todos os testes)

- [ ] **Step 5: Commit**

```bash
git add lib/signals.js tests/signals.test.js
git commit -m "feat(limitbar): config e leitura incremental de eventos de sinal"
```

---

### Task 2: `lib/signal-hook.js` — script standalone chamado pelos hooks

**Files:**
- Create: `projects/limitbar/lib/signal-hook.js`
- Test: `projects/limitbar/tests/signal-hook.test.js`

**Interfaces:**
- Consumes: `signals.eventsFile()` (Task 1)
- Produces: `appendEvent(svc, kind, now = Date.now()) -> void` (nunca lança); quando chamado via CLI (`node lib/signal-hook.js <svc> <kind>`), executa `appendEvent` e sempre sai com código 0.

- [ ] **Step 1: Write the failing test**

```js
// projects/limitbar/tests/signal-hook.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir, rmDir } = require('./helpers');
const signals = require('../lib/signals');

function withEventsDir(fn) {
  const dir = tmpDir();
  const prev = process.env.LIMITBAR_EVENTS_DIR;
  process.env.LIMITBAR_EVENTS_DIR = dir;
  delete require.cache[require.resolve('../lib/signal-hook')];
  try { return fn(dir); } finally {
    if (prev === undefined) delete process.env.LIMITBAR_EVENTS_DIR; else process.env.LIMITBAR_EVENTS_DIR = prev;
    rmDir(dir);
  }
}

test('appendEvent: cria a pasta e grava uma linha JSON', () => {
  withEventsDir((dir) => {
    const { appendEvent } = require('../lib/signal-hook');
    appendEvent('claude', 'stop', 123);
    const line = fs.readFileSync(path.join(dir, 'events.log'), 'utf8').trim();
    assert.deepEqual(JSON.parse(line), { svc: 'claude', kind: 'stop', ts: 123 });
  });
});

test('appendEvent: duas chamadas acrescentam, não substituem', () => {
  withEventsDir(() => {
    const { appendEvent } = require('../lib/signal-hook');
    appendEvent('claude', 'stop', 1);
    appendEvent('codex', 'turn-complete', 2);
    const events = signals.readNew(signals.eventsFile(), 0).events;
    assert.deepEqual(events, [{ svc: 'claude', kind: 'stop', ts: 1 }, { svc: 'codex', kind: 'turn-complete', ts: 2 }]);
  });
});

test('appendEvent: pasta sem permissão de escrita não lança', () => {
  const { appendEvent } = require('../lib/signal-hook');
  const prev = process.env.LIMITBAR_EVENTS_DIR;
  process.env.LIMITBAR_EVENTS_DIR = 'Z:\\caminho\\que\\nao\\existe\\de\\jeito\\nenhum';
  try { assert.doesNotThrow(() => appendEvent('claude', 'stop', 1)); }
  finally { if (prev === undefined) delete process.env.LIMITBAR_EVENTS_DIR; else process.env.LIMITBAR_EVENTS_DIR = prev; }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/signal-hook.test.js`
Expected: FAIL (`Cannot find module '../lib/signal-hook'`)

- [ ] **Step 3: Write minimal implementation**

```js
// projects/limitbar/lib/signal-hook.js
// Script standalone (sem Electron): chamado pelos hooks do Claude Code e pelo "notify" do Codex.
// Nunca pode travar nem falhar a CLI que o chamou: qualquer erro é engolido.
const fs = require('fs');
const path = require('path');
const signals = require('./signals');

function appendEvent(svc, kind, now = Date.now()) {
  try {
    fs.mkdirSync(signals.eventsDir(), { recursive: true });
    fs.appendFileSync(signals.eventsFile(), JSON.stringify({ svc, kind, ts: now }) + '\n');
  } catch { /* nunca falha a CLI que chamou este script */ }
}

if (require.main === module) {
  const [svc, kind] = process.argv.slice(2);
  if (svc && kind) appendEvent(svc, kind);
  process.exit(0);
}

module.exports = { appendEvent };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/signal-hook.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/signal-hook.js tests/signal-hook.test.js
git commit -m "feat(limitbar): script de sinal chamado pelos hooks das CLIs"
```

---

### Task 3: `lib/hooks-claude.js` — liga/desliga os hooks `Stop`/`Notification`

**Files:**
- Create: `projects/limitbar/lib/hooks-claude.js`
- Test: `projects/limitbar/tests/hooks-claude.test.js`

**Interfaces:**
- Produces:
  - `withHookEnabled(root, event, command) -> root'` (pura; adiciona o grupo de hook se ainda não houver um igual, por `command`)
  - `withHookDisabled(root, event, command) -> root'` (pura; remove só o grupo cujo `command` bate, preserva os demais)
  - `commandFor(kind) -> string` (`kind` ∈ `'stop' | 'notification'`), usa `path.join(__dirname, 'signal-hook.js')`
  - `setEnabled(enabled) -> void` (lê/mescla/grava `settings.json` do Claude Code, atômico; respeita `CLAUDE_CONFIG_DIR`)

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hooks-claude.test.js`
Expected: FAIL (`Cannot find module '../lib/hooks-claude'`)

- [ ] **Step 3: Write minimal implementation**

```js
// projects/limitbar/lib/hooks-claude.js
// Liga/desliga os hooks "Stop" e "Notification" do Claude Code, sem tocar em nada que já exista.
// Formato dos hooks: eventos sem "matcher" (Stop/Notification não são eventos de ferramenta) levam
// um grupo { hooks: [{ type: "command", command }] } direto na lista do evento.
const fs = require('fs');
const os = require('os');
const path = require('path');

const settingsPath = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
const signalHookPath = () => path.join(__dirname, 'signal-hook.js');
const commandFor = (kind) => `node ${JSON.stringify(signalHookPath())} claude ${kind}`;

function withHookEnabled(root, event, command) {
  const hooks = { ...(root.hooks || {}) };
  const list = Array.isArray(hooks[event]) ? hooks[event].slice() : [];
  const already = list.some((g) => Array.isArray(g.hooks) && g.hooks.some((h) => h.command === command));
  hooks[event] = already ? list : [...list, { hooks: [{ type: 'command', command }] }];
  return { ...root, hooks };
}

function withHookDisabled(root, event, command) {
  if (!root.hooks || !Array.isArray(root.hooks[event])) return root;
  const hooks = { ...root.hooks };
  const kept = root.hooks[event]
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => h.command !== command) }))
    .filter((g) => g.hooks.length > 0);
  if (kept.length) hooks[event] = kept; else delete hooks[event];
  return { ...root, hooks };
}

function writeAtomic(file, text) {
  const tmp = `${file}.limitbar-${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function setEnabled(enabled) {
  const file = settingsPath();
  let root;
  try { root = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { root = {}; }
  const fn = enabled ? withHookEnabled : withHookDisabled;
  root = fn(fn(root, 'Stop', commandFor('stop')), 'Notification', commandFor('notification'));
  writeAtomic(file, JSON.stringify(root, null, 2));
}

module.exports = { withHookEnabled, withHookDisabled, commandFor, setEnabled, settingsPath };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/hooks-claude.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/hooks-claude.js tests/hooks-claude.test.js
git commit -m "feat(limitbar): liga/desliga os hooks Stop e Notification do Claude Code"
```

---

### Task 4: `lib/hooks-codex.js` — liga/desliga o `notify` do Codex

**Files:**
- Create: `projects/limitbar/lib/hooks-codex.js`
- Test: `projects/limitbar/tests/hooks-codex.test.js`

**Interfaces:**
- Produces:
  - `notifyLine() -> string` (linha TOML completa, usando `path.join(__dirname, 'signal-hook.js')`)
  - `withNotifyEnabled(text) -> { text, conflict }` (pura; `conflict: true` quando já existe um `notify` de outra origem — não altera `text` nesse caso)
  - `withNotifyDisabled(text) -> string` (pura; remove a linha só se for a nossa)
  - `setEnabled(enabled) -> { ok, conflict }` (lê/grava `config.toml` do Codex, atômico; respeita `CODEX_HOME`)

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hooks-codex.test.js`
Expected: FAIL (`Cannot find module '../lib/hooks-codex'`)

- [ ] **Step 3: Write minimal implementation**

```js
// projects/limitbar/lib/hooks-codex.js
// Liga/desliga o "notify" do Codex CLI. O Codex só aceita um notify por configuração:
// se já existir um de outra origem, não mexemos (conflict: true) até o usuário resolver.
const fs = require('fs');
const os = require('os');
const path = require('path');

const configPath = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
const signalHookPath = () => path.join(__dirname, 'signal-hook.js');
const NOTIFY_RE = /^notify\s*=.*$/m;
const notifyLine = () => `notify = ["node", ${JSON.stringify(signalHookPath())}, "codex", "turn-complete"]`;
const isOurs = (line) => line.includes('signal-hook.js') && line.includes('"codex"') && line.includes('turn-complete');

function withNotifyEnabled(text) {
  const match = text.match(NOTIFY_RE);
  if (!match) {
    const sep = text.length && !text.endsWith('\n') ? '\n' : '';
    return { text: text + sep + notifyLine() + '\n', conflict: false };
  }
  if (isOurs(match[0])) return { text, conflict: false };
  return { text, conflict: true };
}

function withNotifyDisabled(text) {
  const match = text.match(NOTIFY_RE);
  if (!match || !isOurs(match[0])) return text;
  return text.replace(NOTIFY_RE, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

function writeAtomic(file, text) {
  const tmp = `${file}.limitbar-${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function setEnabled(enabled) {
  const file = configPath();
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
  const { text: next, conflict } = enabled ? withNotifyEnabled(text) : { text: withNotifyDisabled(text), conflict: false };
  if (conflict) return { ok: false, conflict: true };
  writeAtomic(file, next);
  return { ok: true, conflict: false };
}

module.exports = { withNotifyEnabled, withNotifyDisabled, notifyLine, setEnabled, configPath };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/hooks-codex.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/hooks-codex.js tests/hooks-codex.test.js
git commit -m "feat(limitbar): liga/desliga o notify do Codex CLI"
```

---

### Task 5: Fiar no `main.js` — configuração, watcher de eventos, notificação sonora

**Files:**
- Modify: `projects/limitbar/main.js`
- Test: nenhum arquivo de teste dedicado (lógica de orquestração do Electron não é testada por `node:test`, igual ao resto de `main.js`); validado manualmente no Task 7.

**Interfaces:**
- Consumes: `signals.normalizeConfig/eventsFile/readNew` (Task 1), `hooksClaude.setEnabled` (Task 3), `hooksCodex.setEnabled` (Task 4), `notify(title, body)` já existente em `main.js:40`.
- Produces: `settings.signals` persistido em `window.json`; `ipcMain` handler `'set-signals'`; campo `signals` em `sendSettings()`.

- [ ] **Step 1: Adicionar os requires e o estado inicial**

Em `main.js`, junto dos outros requires de `lib/` (linha 6-9):

```js
const signalsLib = require('./lib/signals');
const hooksClaude = require('./lib/hooks-claude');
const hooksCodex = require('./lib/hooks-codex');
```

No objeto `settings` (linha 18-21), acrescentar `signals: signalsLib.normalizeConfig({})`.

- [ ] **Step 2: Observar o arquivo de eventos e tocar o som**

Adicionar, perto de `const alerts = alertsLib.create();` (linha 24):

```js
let signalOffset = 0, signalWatcher = null;
const SIGNAL_LABEL = { stop: 'terminou', notification: 'esperando sua decisão', 'turn-complete': 'terminou' };
const SVC_LABEL = { claude: 'Claude', codex: 'Codex' };

function handleSignalEvents() {
  const { events, offset } = signalsLib.readNew(signalsLib.eventsFile(), signalOffset);
  signalOffset = offset;
  for (const e of events) {
    if (!settings.signals.enabled || settings.signals.services[e.svc] === false) continue;
    notify(`${SVC_LABEL[e.svc] || e.svc} — ${SIGNAL_LABEL[e.kind] || e.kind}`, '');
  }
}

function watchSignals() {
  if (signalWatcher) return;
  try { fs.mkdirSync(signalsLib.eventsDir(), { recursive: true }); } catch { /* ignora */ }
  signalOffset = signalsLib.readNew(signalsLib.eventsFile(), 0).offset; // ignora o que já existia antes de abrir
  try {
    signalWatcher = fs.watch(signalsLib.eventsDir(), (_evt, filename) => {
      if (filename === 'events.log') handleSignalEvents();
    });
  } catch { /* pasta indisponível: sem observação, sem som */ }
}
```

- [ ] **Step 3: `setSignals` — liga/desliga os hooks por serviço e persiste**

Perto de `setKeepAlive` (linha 177-189):

```js
function setSignals(patch) {
  const before = settings.signals;
  const next = signalsLib.normalizeConfig({ ...before, ...patch, services: { ...before.services, ...((patch && patch.services) || {}) } });
  let codexConflict = false;
  for (const svc of ['claude', 'codex']) {
    const was = before.enabled && before.services[svc] !== false;
    const now = next.enabled && next.services[svc] !== false;
    if (was === now) continue;
    if (svc === 'claude') hooksClaude.setEnabled(now);
    else {
      const r = hooksCodex.setEnabled(now);
      if (now && !r.ok) { codexConflict = true; next.services.codex = false; }
    }
  }
  settings.signals = next;
  saveSettings();
  if (codexConflict) {
    notify('Não foi possível ligar para o Codex', 'Já existe um "notify" configurado em config.toml. Remova-o manualmente para usar este alerta.');
  }
  sendSettings();
}
```

- [ ] **Step 4: Expor no IPC, no `sendSettings` e iniciar o watcher**

Em `sendSettings()` (linha 159-167), acrescentar `signals: settings.signals,` ao objeto enviado.

Perto de `settings.keepAlive = keepAliveLib.normalizeConfig(settings.keepAlive);` (linha 323):

```js
settings.signals = signalsLib.normalizeConfig(settings.signals);
```

Junto dos outros `ipcMain.on` (perto da linha 367):

```js
ipcMain.on('set-signals', (_e, patch) => setSignals(patch && typeof patch === 'object' ? patch : {}));
```

Depois de `createDock();` (linha 358) ou junto de `watchHover(); watchTaskbar();` (linhas 417-418):

```js
if (settings.signals.enabled) watchSignals();
```

E dentro de `setSignals`, logo após `settings.signals = next;`, iniciar o watcher se acabou de ligar:

```js
if (next.enabled && !signalWatcher) watchSignals();
```

Parar o watcher ao sair, junto de `app.on('before-quit', ...)` (linha 427):

```js
app.on('before-quit', () => { timers.forEach(clearInterval); if (signalWatcher) signalWatcher.close(); });
```

(Substituir a linha existente por essa, em vez de duplicar o listener.)

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "feat(limitbar): liga o alerta de fim de execucao/decisao pendente no processo principal"
```

---

### Task 6: UI — nova seção de configurações e exposição no `preload.js`

**Files:**
- Modify: `projects/limitbar/preload.js`
- Modify: `projects/limitbar/index.html`

**Interfaces:**
- Consumes: `settings.signals` (Task 5), evento IPC `'settings'` já tratado pelo script inline de `index.html`.
- Produces: `window.api.setSignals(patch)`.

- [ ] **Step 1: Expor o IPC no `preload.js`**

Em `preload.js`, junto de `setKeepAlive` (linha 13):

```js
setSignals: (patch) => ipcRenderer.send('set-signals', patch),
```

- [ ] **Step 2: Nova seção nas configurações, em `index.html`**

Depois da seção "Janela de 5h" (depois da linha 248, antes de `<details class="ps"><summary>Claude</summary>`):

```html
<details class="ps">
  <summary>Avisos de atividade</summary>
  <div class="pbody">
  <label class="opt">
    <span><b>Avisar quando terminar ou precisar de você</b><small>Toca um som ao fim de uma resposta ou quando uma ferramenta espera sua permissão.</small></span>
    <input type="checkbox" id="sg-on" class="sw">
  </label>
  <div class="grp" id="sg-opts">
    <div class="opt col"><b>Para</b><div class="chips" id="sg-svc"></div></div>
  </div>
  <small class="hint">Exige Node.js no PATH e só funciona com o LimitBar aberto.</small>
</div>
</details>
```

- [ ] **Step 3: Script de ligação (chips + toggle), seguindo o padrão de `al-on`/`al-svc`**

Junto do bloco que popula `al-svc` (perto da linha 502, `$('al-svc').innerHTML = ...`):

```js
$('sg-svc').innerHTML = KEYS.map((k) => `<button class="chip" data-k="${k}" aria-pressed="${cfg.signals.services[k] !== false}">${SVC[k].name}</button>`).join('');
$('sg-opts').classList.toggle('off', !cfg.signals.enabled);
```

Junto de `$('al-on').checked = s.alerts.enabled;` (perto da linha 543):

```js
$('sg-on').checked = s.signals.enabled;
```

Junto dos handlers de clique de `al-svc`/`al-on` (perto das linhas 570-581):

```js
$('sg-on').onchange = (e) => window.api.setSignals({ enabled: e.target.checked });
$('sg-svc').onclick = (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  const k = b.dataset.k;
  window.api.setSignals({ services: { [k]: cfg.signals.services[k] === false } });
};
```

- [ ] **Step 4: Verificar manualmente**

Run: `npm start` (dentro de `projects/limitbar`)
Expected: abrir ⚙ mostra a seção "Avisos de atividade" com o toggle e os chips Claude/Codex, espelhando o estado salvo.

- [ ] **Step 5: Commit**

```bash
git add preload.js index.html
git commit -m "feat(limitbar): secao de configuracoes do alerta de fim de execucao/decisao pendente"
```

---

### Task 7: Teste manual de ponta a ponta

**Files:** nenhum (validação, sem código novo)

- [ ] **Step 1: Rodar a suíte completa**

Run: `npm test` (dentro de `projects/limitbar`)
Expected: todos os testes passam, incluindo os quatro arquivos novos (`signals`, `signal-hook`, `hooks-claude`, `hooks-codex`).

- [ ] **Step 2: Ligar o alerta para o Claude Code e disparar de verdade**

Com `CLAUDE_CONFIG_DIR` apontando para o perfil real (ou usando o padrão), rodar `npm start`, abrir ⚙ → Avisos de atividade → ligar, marcar Claude. Confirmar que `~/.claude/settings.json` ganhou os hooks `Stop`/`Notification` apontando para `lib/signal-hook.js` (caminho absoluto da pasta onde o LimitBar está rodando).

Em outro terminal, rodar uma mensagem simples no Claude Code (`claude -p "oi"`) e confirmar que, ao terminar, aparece um toast do Windows com som e o texto "Claude — terminou".

- [ ] **Step 3: Repetir para o Codex e para o caminho de conflito**

Ligar para o Codex, confirmar a linha `notify` em `~/.codex/config.toml`, rodar uma sessão do Codex e confirmar o toast "Codex — terminou". Depois, colocar manualmente um `notify` diferente no `config.toml`, desligar e religar o alerta do Codex nas configurações, e confirmar que aparece o toast "Não foi possível ligar para o Codex" e o chip do Codex volta a ficar desmarcado.

- [ ] **Step 4: Desligar e confirmar reversão**

Desligar o alerta para os dois serviços e confirmar que os hooks somem de `~/.claude/settings.json` (chave `hooks` inteira, se não sobrar nada) e a linha `notify` some de `~/.codex/config.toml`, sem afetar o resto desses arquivos.
