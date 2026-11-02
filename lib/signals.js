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
