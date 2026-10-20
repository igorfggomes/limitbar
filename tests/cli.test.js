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
    if (file !== 'taskkill') setImmediate(() => behavior(child));
    return child;
  };
  fn.calls = calls;
  return fn;
}
const ENV = { ComSpec: 'C:\\Windows\\System32\\cmd.exe', PATH: 'x', ANTHROPIC_API_KEY: 'segredo', OPENAI_API_KEY: 'segredo' };

test('run: sucesso com código 0; roda numa pasta vazia, sem chaves de API, e limpa depois', async () => {
  const spawnFn = fakeSpawn((c) => c.emit('close', 0));
  const root = tmpDir();
  try {
    const r = await cli.run('claude', { spawnFn, env: ENV, tmp: root });
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

test('run: comando não instalado vira uma mensagem que diz o que fazer', async () => {
  const spawnFn = fakeSpawn((c) => { c.stderr.emit('data', "'codex' não é reconhecido como um comando interno"); c.emit('close', 1); });
  const r = await cli.run('codex', { spawnFn, env: ENV });
  assert.equal(r.ok, false);
  assert.match(r.error, /não encontrei o comando "codex"/);
  assert.match(r.error, /instale/);
});

test('run: código de saída diferente de zero informa o código e a última linha de erro', async () => {
  const spawnFn = fakeSpawn((c) => { c.stderr.emit('data', 'linha 1\nNot logged in\n'); c.emit('close', 3); });
  const r = await cli.run('claude', { spawnFn, env: ENV });
  assert.equal(r.ok, false);
  assert.match(r.error, /código 3/);
  assert.match(r.error, /Not logged in/);
});

test('run: erro ao iniciar o processo não rejeita a promessa', async () => {
  const spawnFn = fakeSpawn((c) => c.emit('error', new Error('EPERM')));
  assert.deepEqual(await cli.run('claude', { spawnFn, env: ENV }), { ok: false, error: 'EPERM' });
  const throwing = () => { throw new Error('sem permissão'); };
  assert.deepEqual(await cli.run('claude', { spawnFn: throwing, env: ENV }), { ok: false, error: 'sem permissão' });
});

test('run: tempo esgotado encerra o processo (e os filhos) e falha', async () => {
  const spawnFn = fakeSpawn(() => { /* nunca termina */ });
  const r = await cli.run('claude', { spawnFn, env: ENV, timeoutMs: 30 });
  assert.deepEqual(r, { ok: false, error: 'tempo esgotado' });
  const kill = spawnFn.calls.find((c) => c.file === 'taskkill');
  assert.ok(kill, 'chamou o taskkill');
  assert.deepEqual(kill.args, ['/pid', '4321', '/T', '/F']);
});

test('run: serviço desconhecido falha sem rodar nada', async () => {
  const spawnFn = fakeSpawn((c) => c.emit('close', 0));
  const r = await cli.run('gemini', { spawnFn, env: ENV });
  assert.equal(r.ok, false);
  assert.equal(spawnFn.calls.length, 0);
});
