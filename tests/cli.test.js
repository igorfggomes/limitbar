const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const cli = require('../lib/cli');
const { tmpDir, rmDir } = require('./helpers');

// ------------------------------------------------------------------ comandos
test('claude: modelo barato, sem sessão salva e sem ferramentas (--tools por último)', () => {
  const c = cli.buildCommand('claude');
  assert.match(c, /^claude -p "/);
  assert.match(c, /--model haiku/);
  assert.match(c, /--no-session-persistence/);
  assert.ok(c.endsWith('--tools ""'), '--tools aceita vários valores, então fica no fim');
});

test('codex: somente leitura e SEM --ephemeral (o LimitBar lê o log da sessão)', () => {
  const c = cli.buildCommand('codex');
  assert.match(c, /^codex exec /);
  assert.match(c, /-s read-only/);
  assert.match(c, /--skip-git-repo-check/);
  assert.doesNotMatch(c, /--ephemeral/);
});

test('os comandos não têm caracteres que o cmd.exe interpretaria', () => {
  for (const svc of ['claude', 'codex']) {
    const c = cli.buildCommand(svc);
    assert.doesNotMatch(c.replace(/"/g, ''), /[&|<>^%!]/, svc);
  }
  assert.doesNotMatch(cli.PROMPT, /["&|<>^%!]/);
});

test('serviço desconhecido é erro', () => {
  assert.throws(() => cli.buildCommand('gemini'), /desconhecido/);
});

test('cleanEnv tira as chaves de API (para não cobrar da API) e não altera o original', () => {
  const env = { PATH: 'x', ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 'b', OPENAI_API_KEY: 'c', CODEX_API_KEY: 'd', OUTRA: '1' };
  const out = cli.cleanEnv(env);
  assert.deepEqual(out, { PATH: 'x', OUTRA: '1' });
  assert.equal(env.ANTHROPIC_API_KEY, 'a');
});

// ------------------------------------------------------------------ execução (spawn falso)
function fakeSpawn(behavior) {
  const calls = [];
  const fn = (file, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 4321;
    calls.push({ file, args, opts, dirExisted: opts && opts.cwd ? fs.existsSync(opts.cwd) : null });
    if (file !== 'taskkill' && file !== 'kill') setImmediate(() => behavior(child, opts));
    return child;
  };
  fn.calls = calls;
  return fn;
}
const ENV = { ComSpec: 'C:\\Windows\\System32\\cmd.exe', PATH: 'x', ANTHROPIC_API_KEY: 'segredo', OPENAI_API_KEY: 'segredo' };
// "platform" é injetado nos testes pra cobrir os dois ramos (win/posix) sem depender do SO
// que está rodando o teste de verdade (a suíte roda tanto no Windows quanto no Linux no CI).
const WIN = { env: ENV, platform: 'win32' };

test('run (win): sucesso com código 0; roda numa pasta vazia, sem chaves de API, e limpa depois', async () => {
  const spawnFn = fakeSpawn((c) => c.emit('close', 0));
  const root = tmpDir();
  try {
    const r = await cli.run('claude', { spawnFn, ...WIN, tmp: root });
    assert.deepEqual(r, { ok: true });
    const call = spawnFn.calls[0];
    assert.equal(call.file, ENV.ComSpec);
    assert.deepEqual(call.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.equal(call.args[3], `"${cli.buildCommand('claude')}"`);
    assert.equal(call.opts.windowsVerbatimArguments, true);
    assert.equal(call.opts.windowsHide, true);
    assert.equal(call.opts.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(call.opts.env.OPENAI_API_KEY, undefined);
    assert.equal(call.opts.env.PATH, 'x');
    assert.equal(call.dirExisted, true, 'pasta de trabalho existia durante a execução');
    // e era a pasta temporária vazia criada para isto, nunca a pasta do projeto nem a atual
    assert.equal(path.dirname(call.opts.cwd), root);
    assert.match(path.basename(call.opts.cwd), /^limitbar-ka-/);
    assert.notEqual(path.resolve(call.opts.cwd), path.resolve(process.cwd()));
    assert.equal(fs.readdirSync(root).length, 0, 'e foi apagada depois');
  } finally { rmDir(root); }
});

test('run (win): comando não instalado vira uma mensagem que diz o que fazer', async () => {
  const spawnFn = fakeSpawn((c) => { c.stderr.emit('data', "'codex' não é reconhecido como um comando interno"); c.emit('close', 1); });
  const r = await cli.run('codex', { spawnFn, ...WIN });
  assert.equal(r.ok, false);
  assert.match(r.error, /não encontrei o comando "codex"/);
  assert.match(r.error, /instale/);
});

test('run (win): código de saída diferente de zero informa o código e a última linha de erro', async () => {
  const spawnFn = fakeSpawn((c) => { c.stderr.emit('data', 'linha 1\nNot logged in\n'); c.emit('close', 3); });
  const r = await cli.run('claude', { spawnFn, ...WIN });
  assert.equal(r.ok, false);
  assert.match(r.error, /código 3/);
  assert.match(r.error, /Not logged in/);
});

test('run (win): erro ao iniciar o processo não rejeita a promessa', async () => {
  const spawnFn = fakeSpawn((c) => c.emit('error', new Error('EPERM')));
  assert.deepEqual(await cli.run('claude', { spawnFn, ...WIN }), { ok: false, error: 'EPERM' });
  const throwing = () => { throw new Error('sem permissão'); };
  assert.deepEqual(await cli.run('claude', { spawnFn: throwing, ...WIN }), { ok: false, error: 'sem permissão' });
});

test('run (win): tempo esgotado chama o taskkill com o pid e falha', async () => {
  const spawnFn = fakeSpawn(() => { /* nunca termina */ });
  const r = await cli.run('claude', { spawnFn, ...WIN, timeoutMs: 30 });
  assert.deepEqual(r, { ok: false, error: 'tempo esgotado' });
  const kill = spawnFn.calls.find((c) => c.file === 'taskkill');
  assert.ok(kill, 'chamou o taskkill');
  assert.deepEqual(kill.args, ['/pid', '4321', '/T', '/F']);
});

// ------------------------------------------------------------------ execução (Linux/macOS)
test('run (posix): roda via /bin/sh -c, com o processo desanexado pro grupo poder ser matado', async () => {
  const spawnFn = fakeSpawn((c) => c.emit('close', 0));
  const r = await cli.run('claude', { spawnFn, env: ENV, platform: 'linux' });
  assert.deepEqual(r, { ok: true });
  const call = spawnFn.calls[0];
  assert.equal(call.file, '/bin/sh');
  assert.deepEqual(call.args, ['-c', cli.buildCommand('claude')]);
  assert.equal(call.opts.detached, true);
  assert.equal(call.opts.env.ANTHROPIC_API_KEY, undefined);
});

test('run (posix): "comando não encontrado" do shell também vira a mensagem padrão', async () => {
  const spawnFn = fakeSpawn((c) => { c.stderr.emit('data', '/bin/sh: 1: codex: not found\n'); c.emit('close', 127); });
  const r = await cli.run('codex', { spawnFn, env: ENV, platform: 'linux' });
  assert.equal(r.ok, false);
  assert.match(r.error, /não encontrei o comando "codex"/);
});

test('run (posix): tempo esgotado manda SIGKILL pro grupo de processos (pid negativo)', async () => {
  const spawnFn = fakeSpawn(() => { /* nunca termina */ });
  const r = await cli.run('claude', { spawnFn, env: ENV, platform: 'linux', timeoutMs: 30 });
  assert.deepEqual(r, { ok: false, error: 'tempo esgotado' });
  const kill = spawnFn.calls.find((c) => c.file === 'kill');
  assert.ok(kill, 'chamou o kill');
  assert.deepEqual(kill.args, ['-9', '-4321']);
});

test('run: serviço desconhecido falha sem rodar nada', async () => {
  const spawnFn = fakeSpawn((c) => c.emit('close', 0));
  const r = await cli.run('gemini', { spawnFn, env: ENV });
  assert.equal(r.ok, false);
  assert.equal(spawnFn.calls.length, 0);
});

// ------------------------------------------------------------------ limpeza da pasta de projeto do Claude Code
const projectDirFor = (base, cwd) => path.join(base, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));

test('run (claude): remove a pasta de projeto vazia que o Claude Code criou para a pasta temporária', async () => {
  const base = tmpDir('limitbar-cfg-');
  let created;
  try {
    const spawnFn = fakeSpawn((c, opts) => { created = projectDirFor(base, opts.cwd); fs.mkdirSync(created, { recursive: true }); c.emit('close', 0); });
    const r = await cli.run('claude', { spawnFn, env: { ...ENV, CLAUDE_CONFIG_DIR: base } });
    assert.equal(r.ok, true);
    assert.ok(created.includes('limitbar-ka-'));
    assert.equal(fs.existsSync(created), false, 'pasta de projeto vazia removida');
    assert.equal(fs.existsSync(path.join(base, 'projects')), true, 'a pasta "projects" em si fica');
  } finally { rmDir(base); }
});

test('run (claude): se a pasta de projeto tiver conteúdo, ela NÃO é apagada', async () => {
  const base = tmpDir('limitbar-cfg-');
  let created;
  try {
    const spawnFn = fakeSpawn((c, opts) => {
      created = projectDirFor(base, opts.cwd); fs.mkdirSync(created, { recursive: true });
      fs.writeFileSync(path.join(created, 'sessao.jsonl'), '{}');
      c.emit('close', 0);
    });
    await cli.run('claude', { spawnFn, env: { ...ENV, CLAUDE_CONFIG_DIR: base } });
    assert.equal(fs.existsSync(path.join(created, 'sessao.jsonl')), true);
  } finally { rmDir(base); }
});

test('run (claude): projetos de outras pastas nunca são tocados', async () => {
  const base = tmpDir('limitbar-cfg-');
  try {
    const outro = path.join(base, 'projects', 'C--Users-igorf-meu-projeto');
    fs.mkdirSync(outro, { recursive: true });
    const spawnFn = fakeSpawn((c) => c.emit('close', 0));
    await cli.run('claude', { spawnFn, env: { ...ENV, CLAUDE_CONFIG_DIR: base } });
    assert.equal(fs.existsSync(outro), true);
  } finally { rmDir(base); }
});

test('run (codex): não mexe em nenhuma pasta de projeto do Claude', async () => {
  const base = tmpDir('limitbar-cfg-');
  try {
    // uma pasta de projeto com o nome EXATO da pasta de trabalho: só o Claude teria direito de limpá-la
    let dir;
    const spawnFn = fakeSpawn((c, opts) => { dir = projectDirFor(base, opts.cwd); fs.mkdirSync(dir, { recursive: true }); c.emit('close', 0); });
    const r = await cli.run('codex', { spawnFn, env: { ...ENV, CLAUDE_CONFIG_DIR: base } });
    assert.equal(r.ok, true);
    assert.equal(fs.existsSync(dir), true, 'o Codex não apaga pastas de projeto do Claude');
  } finally { rmDir(base); }
});
