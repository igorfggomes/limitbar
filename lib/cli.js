// Executa a mensagem mínima nas CLIs oficiais (Claude Code e Codex) para iniciar uma janela de 5h.
// O custo é medido por quem chama; aqui só se monta e se roda o comando com segurança.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// sem aspas, "&", "|", "<", ">", "^" ou "%" para não dar problema no cmd.exe
const PROMPT = 'Responda apenas: ok';
const TIMEOUT_MS = 120e3;

// Claude: modelo mais barato, sem salvar sessão e sem ferramentas. "--tools" aceita vários valores,
// então vai por último para não engolir nada que viesse depois.
function buildCommand(svc) {
  if (svc === 'claude') return `claude -p "${PROMPT}" --model haiku --no-session-persistence --tools ""`;
  // Codex: sem "--ephemeral" de propósito. O LimitBar enxerga a janela pelos logs de sessão do Codex,
  // então a sessão precisa ser gravada para a janela nova aparecer.
  if (svc === 'codex') return `codex exec --skip-git-repo-check -s read-only "${PROMPT}"`;
  throw new Error(`serviço desconhecido: ${svc}`);
}

// Chaves de API no ambiente fariam a CLI cobrar pela API em vez de usar a assinatura.
const STRIP_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
function cleanEnv(env = process.env) {
  const out = { ...env };
  for (const k of STRIP_ENV) delete out[k];
  return out;
}

// O Claude Code cria uma pasta de projeto (vazia, com --no-session-persistence) para cada pasta de trabalho.
// Como a nossa é descartável, sobraria uma pasta nova por disparo; remove a dela. O nome é o caminho da pasta
// com tudo que não é letra ou número trocado por "-"; rmdir só apaga pasta vazia, então nunca perde conversa.
function removeEmptyClaudeProject(cwd, env) {
  try {
    const base = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    fs.rmdirSync(path.join(base, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-')));
  } catch { /* não existe ou não está vazia: deixa como está */ }
}

const NOT_FOUND = /não é reconhecido|is not recognized|not found/i;
const NAMES = { claude: 'claude', codex: 'codex' };

// spawnFn é injetável (testes). Sempre resolve (nunca rejeita) com { ok, error? }.
function run(svc, { spawnFn = spawn, timeoutMs = TIMEOUT_MS, env = process.env, tmp = os.tmpdir() } = {}) {
  return new Promise((resolve) => {
    let dir, child, done = false, timer, stderr = '';
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (dir) {
        // no Windows o processo filho pode soltar o handle da pasta um instante depois do "close"
        // (antivírus, processos-netos ainda saindo), o que derruba rmSync com EBUSY/EPERM; maxRetries
        // tenta de novo antes de desistir, e o try/catch garante que nunca suba sem ser tratado.
        try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* limpa na próxima vez */ }
        if (svc === 'claude') removeEmptyClaudeProject(dir, env);
      }
      resolve(r);
    };
    try {
      dir = fs.mkdtempSync(path.join(tmp, 'limitbar-ka-')); // pasta vazia: nenhum projeto vira contexto
      child = spawnFn(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${buildCommand(svc)}"`], {
        cwd: dir, env: cleanEnv(env), windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) { return finish({ ok: false, error: e.message }); }

    if (child.stderr) child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += String(d); });
    if (child.stdout) child.stdout.on('data', () => { /* descartado: só importa o código de saída */ });
    child.on('error', (e) => finish({ ok: false, error: e.message }));
    child.on('close', (code) => {
      if (code === 0) return finish({ ok: true });
      if (NOT_FOUND.test(stderr) || code === 9009) return finish({ ok: false, error: `não encontrei o comando "${NAMES[svc]}": instale e entre na sua conta` });
      const tail = stderr.trim().split('\n').slice(-1)[0].slice(0, 160);
      finish({ ok: false, error: `saiu com código ${code}${tail ? ': ' + tail : ''}` });
    });
    timer = setTimeout(() => {
      try { spawnFn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* já saiu */ }
      finish({ ok: false, error: 'tempo esgotado' });
    }, timeoutMs);
  });
}

module.exports = { buildCommand, cleanEnv, run, PROMPT, STRIP_ENV };
