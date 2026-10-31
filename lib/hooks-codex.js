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
