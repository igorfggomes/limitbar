// projects/limitbar/lib/hooks-codex.js
// Liga/desliga o "notify" do Codex CLI. O Codex só aceita um notify por configuração:
// se já existir um de outra origem, não mexemos (conflict: true) até o usuário resolver.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeAtomic } = require('./atomic-write');

const configPath = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
const signalHookPath = () => path.join(__dirname, 'signal-hook.js');
const NOTIFY_RE = /^notify\s*=.*$/m;
const notifyLine = () => `notify = ["node", ${JSON.stringify(signalHookPath())}, "codex", "turn-complete"]`;
const isOurs = (line) => line.includes('signal-hook.js') && line.includes('"codex"') && line.includes('turn-complete');

// Só o trecho antes do primeiro cabeçalho [table] é "nível superior": um notify dentro de
// [profiles.x] pertence àquela tabela e o Codex não o lê como o notify global — ignorá-lo evita
// tanto falso conflito ao ligar quanto remoção indevida ao desligar.
const headerIndex = (text) => { const i = text.search(/^\[/m); return i === -1 ? text.length : i; };

function withNotifyEnabled(text) {
  const headerIdx = headerIndex(text);
  const head = text.slice(0, headerIdx);
  const match = head.match(NOTIFY_RE);
  if (!match) {
    const line = notifyLine() + '\n';
    if (headerIdx === text.length) {
      const sep = text.length && !text.endsWith('\n') ? '\n' : '';
      return { text: text + sep + line, conflict: false };
    }
    return { text: head + line + text.slice(headerIdx), conflict: false };
  }
  if (isOurs(match[0])) return { text, conflict: false };
  return { text, conflict: true };
}

function withNotifyDisabled(text) {
  const headerIdx = headerIndex(text);
  const head = text.slice(0, headerIdx);
  const match = head.match(NOTIFY_RE);
  if (!match || !isOurs(match[0])) return text;
  const cleaned = head.replace(NOTIFY_RE, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return cleaned + text.slice(headerIdx);
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
