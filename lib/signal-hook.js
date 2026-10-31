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
