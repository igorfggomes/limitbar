// lib/accounts.js
// Perfis de conta Claude: snapshots de .credentials.json com apelido, para trocar a conta
// ativa sem logout/login manual. Sem dependência do Electron — testável isolado.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const hashId = (refreshToken) => crypto.createHash('sha256').update(String(refreshToken)).digest('hex').slice(0, 12);

function identify(credentialsJson) {
  const rt = credentialsJson && credentialsJson.claudeAiOauth && credentialsJson.claudeAiOauth.refreshToken;
  return rt ? hashId(rt) : null;
}

const profileFile = (dir, id) => path.join(dir, `${id}.json`);
const activeFile = (dir) => path.join(dir, 'active.json');
const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

function readProfile(dir, id) {
  try { return JSON.parse(fs.readFileSync(profileFile(dir, id), 'utf8')); } catch { return null; }
}

function listProfiles(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (n === 'active.json' || !n.endsWith('.json')) continue;
    const p = readProfile(dir, n.slice(0, -5));
    if (p && p.id) out.push({ id: p.id, label: p.label, savedAt: p.savedAt });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

function readActiveId(dir) {
  try { return JSON.parse(fs.readFileSync(activeFile(dir), 'utf8')).id || null; } catch { return null; }
}

function setActiveId(dir, id) {
  ensureDir(dir);
  fs.writeFileSync(activeFile(dir), JSON.stringify({ id: id || null }));
}

function saveProfile(dir, label, credentialsJson) {
  const id = identify(credentialsJson);
  if (!id) throw new Error('credenciais sem refreshToken');
  ensureDir(dir);
  fs.writeFileSync(profileFile(dir, id), JSON.stringify({ id, label: String(label || 'Conta').trim().slice(0, 40) || 'Conta', savedAt: Date.now(), credentials: credentialsJson }));
  setActiveId(dir, id);
  return id;
}

function rename(dir, id, label) {
  const p = readProfile(dir, id);
  if (!p) return false;
  p.label = String(label || p.label).trim().slice(0, 40) || p.label;
  fs.writeFileSync(profileFile(dir, id), JSON.stringify(p));
  return true;
}

function remove(dir, id) {
  try { fs.unlinkSync(profileFile(dir, id)); } catch { /* já não existe */ }
  if (readActiveId(dir) === id) setActiveId(dir, null);
}

module.exports = { hashId, identify, listProfiles, readProfile, readActiveId, setActiveId, saveProfile, rename, remove };
