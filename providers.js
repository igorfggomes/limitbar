const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();

// Cada provider devolve { ok, windows: [{label, percent, resetsAt(ms)}], error? }

// O endpoint de uso do Claude limita consultas (HTTP 429). Por isso: no máximo uma consulta a cada
// MIN_GAP_MS, espera o Retry-After quando recebe 429 e, em qualquer falha, mostra o último valor bom.
const MIN_GAP_MS = 150 * 1000;
const BACKOFF_START_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;
let claudeCache = null; // { windows, fetchedAt }
let claudeNextTry = 0;
let claudeBackoff = 0;

// valor guardado: janelas que já resetaram desde a leitura voltam a 0%
function fromCache(stale) {
  const now = Date.now();
  const windows = claudeCache.windows.map((w) => (w.resetsAt && w.resetsAt < now ? { ...w, percent: 0, resetsAt: null } : w));
  return { ok: true, windows, stale, fetchedAt: claudeCache.fetchedAt };
}

async function claude() {
  const now = Date.now();
  if (claudeCache && now - claudeCache.fetchedAt < MIN_GAP_MS) return fromCache(false);
  if (now < claudeNextTry) {
    return claudeCache ? fromCache(true)
      : { ok: false, error: `Limite de consultas — nova tentativa às ${new Date(claudeNextTry).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` };
  }
  try {
    const credPath = path.join(HOME, '.claude', '.credentials.json');
    const o = JSON.parse(fs.readFileSync(credPath, 'utf8')).claudeAiOauth;
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${o.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) return { ok: false, error: 'Token expirado — abra o Claude Code para renovar' };
    if (res.status === 429) {
      const retryAfter = (parseInt(res.headers.get('retry-after'), 10) || 0) * 1000;
      claudeBackoff = Math.min(BACKOFF_MAX_MS, claudeBackoff ? claudeBackoff * 2 : BACKOFF_START_MS);
      claudeNextTry = now + Math.min(BACKOFF_MAX_MS, Math.max(retryAfter, claudeBackoff));
      return claudeCache ? fromCache(true)
        : { ok: false, error: 'Limite de consultas do Claude — tentando de novo em alguns minutos' };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const w = (label, x, windowMs) => x && { label, percent: x.utilization, resetsAt: Date.parse(x.resets_at), windowMs };
    claudeCache = {
      windows: [w('5 horas', j.five_hour, 5 * 3600e3), w('Semanal', j.seven_day, 7 * 86400e3)].filter(Boolean),
      fetchedAt: Date.now(),
    };
    claudeBackoff = 0; claudeNextTry = 0;
    return fromCache(false);
  } catch (e) {
    if (claudeCache) return fromCache(true); // falha de rede ou 5xx: segura o último valor bom
    return { ok: false, error: e.message };
  }
}

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

async function codex() {
  try {
    const files = newestSessionFiles(path.join(HOME, '.codex', 'sessions'), 15);
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
    return { ok: false, error: 'Nenhum dado de limite nos logs do Codex' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { claude, codex };
