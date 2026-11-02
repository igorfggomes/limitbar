// projects/limitbar/lib/hooks-claude.js
// Liga/desliga os hooks "Stop" e "Notification" do Claude Code, sem tocar em nada que já exista.
// Formato dos hooks: eventos sem "matcher" (Stop/Notification não são eventos de ferramenta) levam
// um grupo { hooks: [{ type: "command", command }] } direto na lista do evento.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeAtomic } = require('./atomic-write');

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

const INVALID_MSG = 'settings.json do Claude Code está inválido; corrija-o antes de ligar o alerta';

// Arquivo ausente -> começa do zero. Arquivo presente mas ilegível/inválido -> erro:
// sobrescrever com {} apagaria toda a configuração do usuário (permissões, env, modelo...).
function readSettings(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return {};
    throw new Error(INVALID_MSG);
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(INVALID_MSG); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(INVALID_MSG);
  return parsed;
}

function setEnabled(enabled) {
  const file = settingsPath();
  let root = readSettings(file);
  const fn = enabled ? withHookEnabled : withHookDisabled;
  root = fn(fn(root, 'Stop', commandFor('stop')), 'Notification', commandFor('notification'));
  writeAtomic(file, JSON.stringify(root, null, 2));
  return { ok: true, conflict: false };
}

module.exports = { withHookEnabled, withHookDisabled, commandFor, setEnabled, settingsPath };
