// Utilitários dos testes (sem dependências externas).
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmpDir = (prefix = 'limitbar-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const rmDir = (d) => fs.rmSync(d, { recursive: true, force: true });

// substitui require('electron') por um app falso (updater.js só precisa de getVersion/isPackaged)
function mockElectron(state = { version: '1.0.0', packaged: true }) {
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return { app: { getVersion: () => state.version, isPackaged: state.packaged } };
    return original.call(this, request, ...rest);
  };
  return () => { Module._load = original; };
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// fetch falso: routes é uma lista de [prefixoDaURL, (url, init) => Response]; guarda as chamadas em .calls
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const route = routes.find(([prefix]) => u.startsWith(prefix));
    if (!route) throw new TypeError('fetch failed');
    return route[1](u, init);
  };
  fn.calls = calls;
  fn.count = (prefix) => calls.filter((c) => c.url.startsWith(prefix)).length;
  return fn;
}

const isoIn = (ms) => new Date(Date.now() + ms).toISOString();

module.exports = { tmpDir, rmDir, mockElectron, json, fakeFetch, isoIn };
