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
