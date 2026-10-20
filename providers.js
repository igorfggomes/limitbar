const fs = require('fs');
const os = require('os');
const path = require('path');

// Cada provider devolve { ok, windows: [{label, percent, resetsAt(ms), windowMs}] }
// ou { ok: false, error, code } com uma mensagem que diz o que fazer.
// Segue as mesmas variáveis de ambiente das ferramentas (CLAUDE_CONFIG_DIR e CODEX_HOME).

const dirs = () => ({
  claude: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  codex: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
});
const config = { autoRefresh: true };
function configure(c) { Object.assign(config, c); }

class ProviderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const hhmm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------- Claude
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// endpoint e identificador de cliente usados pelo próprio Claude Code (conferidos no executável 2.1.x)
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

const MSG = {
  noLogin: 'Claude Code sem login neste computador. Abra o terminal, rode "claude" e entre na sua conta.',
  noSubscription: 'Esta conta do Claude Code usa chave de API. Os limites de 5h e semanal só existem para assinaturas (Pro/Max).',
  expired: 'Sessão do Claude Code expirada. Abra o terminal, rode "claude" e entre de novo.',
};

// O endpoint de uso limita consultas (HTTP 429). Por isso: no máximo uma consulta a cada MIN_GAP_MS,
// espera o Retry-After quando recebe 429 e, em falhas de rede, mostra o último valor bom.
const MIN_GAP_MS = 150 * 1000;
const BACKOFF_START_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;
const REFRESH_BLOCK_MS = 10 * 60 * 1000; // depois de uma renovação recusada, não insiste por um tempo
const EXPIRY_MARGIN_MS = 60 * 1000;

let claudeCache = null; // { windows, fetchedAt }
let claudeNextTry = 0;
let claudeBackoff = 0;
let refreshing = null;
let refreshBlockedUntil = 0;

function _resetForTests() {
  claudeCache = null; claudeNextTry = 0; claudeBackoff = 0; refreshing = null; refreshBlockedUntil = 0;
  config.autoRefresh = true;
}

const credPath = () => path.join(dirs().claude, '.credentials.json');

function readCreds() {
  let raw;
  try { raw = fs.readFileSync(credPath(), 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') throw new ProviderError('not-logged-in', MSG.noLogin);
    throw e;
  }
  let json;
  try { json = JSON.parse(raw); } catch { throw new ProviderError('not-logged-in', MSG.noLogin); }
  const o = json.claudeAiOauth;
  if (!o || !o.accessToken) throw new ProviderError('no-subscription', MSG.noSubscription);
  return { json, o };
}

// grava num arquivo temporário e troca de uma vez, para nunca deixar o arquivo de login pela metade
function writeAtomic(file, text) {
  const tmp = `${file}.limitbar-${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* já não existe */ }
    throw e;
  }
}

// Renova o token. Os tokens de renovação são rotativos: se o servidor devolver um novo, o antigo deixa
// de valer, então o novo PRECISA ser gravado no arquivo do Claude Code. Para não brigar com ele:
//   1) relê o arquivo logo antes de usar o refresh token;
//   2) só grava se o arquivo ainda tem o mesmo token que usamos (senão o Claude Code já renovou e o dele vence).
function renewToken() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (Date.now() < refreshBlockedUntil) throw new ProviderError('session-expired', MSG.expired);
    const { o } = readCreds();
    const used = o.refreshToken;
    if (!used) throw new ProviderError('session-expired', MSG.expired);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: used, client_id: CLIENT_ID, scope: (o.scopes || []).join(' ') }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      refreshBlockedUntil = Date.now() + REFRESH_BLOCK_MS;
      throw new ProviderError('session-expired', MSG.expired);
    }
    if (!res.ok) throw new Error(`Não foi possível renovar o login (HTTP ${res.status})`);
    const d = await res.json();
    if (!d.access_token || !d.expires_in) throw new Error('Resposta inesperada ao renovar o login');

    const now = readCreds();
    if (now.o.refreshToken !== used) return now.o.accessToken; // o Claude Code renovou enquanto isso: o dele vence
    const next = { ...now.o, accessToken: d.access_token, refreshToken: d.refresh_token || used, expiresAt: Date.now() + d.expires_in * 1000 };
    if (d.refresh_token_expires_in) next.refreshTokenExpiresAt = Date.now() + d.refresh_token_expires_in * 1000;
    if (typeof d.scope === 'string' && d.scope) next.scopes = d.scope.split(' ');
    now.json.claudeAiOauth = next;
    writeAtomic(credPath(), JSON.stringify(now.json));
    return next.accessToken;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// valor guardado: janelas que já resetaram desde a leitura voltam a 0%
function fromCache(stale) {
  const now = Date.now();
  const windows = claudeCache.windows.map((w) => (w.resetsAt && w.resetsAt < now ? { ...w, percent: 0, resetsAt: null } : w));
  return { ok: true, windows, stale, fetchedAt: claudeCache.fetchedAt };
}

const fetchUsage = (token) => fetch(USAGE_URL, {
  headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
  signal: AbortSignal.timeout(15000),
});

async function claude(opts = {}) {
  const now = Date.now();
  if (!opts.force && claudeCache && now - claudeCache.fetchedAt < MIN_GAP_MS) return fromCache(false);
  if (now < claudeNextTry) {
    return claudeCache ? fromCache(true)
      : { ok: false, code: 'rate-limited', error: `Limite de consultas do Claude — nova tentativa às ${hhmm(claudeNextTry)}` };
  }
  try {
    const { o } = readCreds();
    let token = o.accessToken;
    if (config.autoRefresh && o.expiresAt && o.expiresAt - now < EXPIRY_MARGIN_MS) token = await renewToken();

    let res = await fetchUsage(token);
    if (res.status === 401 && config.autoRefresh) { token = await renewToken(); res = await fetchUsage(token); }
    if (res.status === 401) throw new ProviderError('session-expired', MSG.expired);
    if (res.status === 429) {
      const retryAfter = (parseInt(res.headers.get('retry-after'), 10) || 0) * 1000;
      claudeBackoff = Math.min(BACKOFF_MAX_MS, claudeBackoff ? claudeBackoff * 2 : BACKOFF_START_MS);
      claudeNextTry = now + Math.min(BACKOFF_MAX_MS, Math.max(retryAfter, claudeBackoff));
      return claudeCache ? fromCache(true)
        : { ok: false, code: 'rate-limited', error: 'Limite de consultas do Claude — tentando de novo em alguns minutos' };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    // Sem janela de 5h em andamento, o servidor pode mandar null ou uma janela sem horário de reset.
    // Em vez de sumir com a barra, mostra "janela livre" (0%, sem reset).
    const w = (label, x, windowMs) => {
      const at = x && x.resets_at ? Date.parse(x.resets_at) : NaN;
      return { label, percent: x && Number.isFinite(x.utilization) ? x.utilization : 0, resetsAt: Number.isFinite(at) ? at : null, windowMs };
    };
    claudeCache = {
      windows: [w('5 horas', j.five_hour, 5 * 3600e3), ...(j.seven_day ? [w('Semanal', j.seven_day, 7 * 86400e3)] : [])],
      fetchedAt: Date.now(),
    };
    claudeBackoff = 0; claudeNextTry = 0;
    return fromCache(false);
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, code: e.code, error: e.message }; // precisa de ação sua: não esconde com valor velho
    if (claudeCache) return fromCache(true); // falha de rede ou 5xx: segura o último valor bom
    return { ok: false, code: 'network', error: e.message === 'fetch failed' ? 'Sem conexão com o servidor do Claude. Verifique sua internet.' : e.message };
  }
}

// ---------------------------------------------------------------- Codex
function newestSessionFiles(dir, limit) {
  const out = [];
  (function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) out.push({ p, m: fs.statSync(p).mtimeMs });
    }
  })(dir);
  return out.sort((a, b) => b.m - a.m).slice(0, limit).map((x) => x.p);
}

function lastRateLimits(file) {
  const size = fs.statSync(file).size;
  const len = Math.min(size, 1024 * 1024);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    try {
      const rl = JSON.parse(lines[i]).payload?.rate_limits;
      if (rl?.primary) return rl;
    } catch { /* linha cortada */ }
  }
  return null;
}

const NO_CODEX = 'Codex CLI não encontrado. Instale-o e rode "codex" para entrar na sua conta.';
const NO_CODEX_DATA = 'Ainda sem dados do Codex. Use-o uma vez e os limites aparecem aqui.';

async function codex() {
  try {
    const home = dirs().codex;
    if (!fs.existsSync(home)) return { ok: false, code: 'not-installed', error: NO_CODEX };
    const files = newestSessionFiles(path.join(home, 'sessions'), 15);
    for (const f of files) {
      const rl = lastRateLimits(f);
      if (!rl) continue;
      const now = Date.now();
      const w = (label, x) => {
        if (!x) return null;
        const resetsAt = x.resets_at * 1000;
        // janela já resetou desde a última leitura: uso real é 0
        const expired = resetsAt < now;
        return { label, percent: expired ? 0 : x.used_percent, resetsAt: expired ? null : resetsAt, windowMs: x.window_minutes * 60e3 };
      };
      return { ok: true, plan: rl.plan_type, windows: [w('5 horas', rl.primary), w('Semanal', rl.secondary)].filter(Boolean) };
    }
    return { ok: false, code: 'no-data', error: NO_CODEX_DATA };
  } catch (e) {
    return { ok: false, code: 'error', error: e.message };
  }
}

module.exports = { claude, codex, configure, ProviderError, _resetForTests };
