// Teste do download contra um servidor HTTP local. LIMITBAR_UPDATE_URL desativa a trava de origem
// (que só aceita github.com/igorfggomes/limitbar), por isso este teste fica em um arquivo separado.
process.env.LIMITBAR_UPDATE_URL = 'http://127.0.0.1:0/release.json';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { mockElectron } = require('./helpers');

const restore = mockElectron({ version: '1.0.0', packaged: true });
const updater = require('../updater');
restore();

const PAYLOAD = crypto.randomBytes(300 * 1024);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let server, base;

test.before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/ok.zip') { res.setHeader('content-length', PAYLOAD.length); res.end(PAYLOAD); }
    else { res.statusCode = 404; res.end('nope'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((r) => server.close(r)));

test('download: baixa, confere o SHA-256 e informa o progresso', async () => {
  const seen = [];
  const file = await updater.download({ assetUrl: base + '/ok.zip', sha256: sha(PAYLOAD), size: PAYLOAD.length }, (p) => seen.push(p));
  try {
    assert.ok(fs.existsSync(file));
    assert.deepEqual(fs.readFileSync(file), PAYLOAD);
    assert.ok(seen.length > 0 && seen[seen.length - 1] === 1, 'termina em 100%');
  } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
});

test('download: SHA-256 diferente é recusado e o arquivo é apagado', async () => {
  const before = fs.readdirSync(require('os').tmpdir()).filter((n) => n.startsWith('limitbar-update-')).length;
  await assert.rejects(() => updater.download({ assetUrl: base + '/ok.zip', sha256: '0'.repeat(64), size: PAYLOAD.length }), /corrompido/);
  const after = fs.readdirSync(require('os').tmpdir()).filter((n) => n.startsWith('limitbar-update-')).length;
  assert.equal(after, before, 'não sobra pasta temporária');
});

test('download: sem SHA-256 publicado, ainda baixa (a origem HTTPS já é confiável)', async () => {
  const file = await updater.download({ assetUrl: base + '/ok.zip', sha256: null, size: PAYLOAD.length });
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('download: erro HTTP vira exceção e não deixa lixo', async () => {
  await assert.rejects(() => updater.download({ assetUrl: base + '/nao-existe.zip', sha256: null, size: 1 }), /HTTP 404/);
});

test('canSelfUpdate: o app empacotado numa pasta gravável pode se atualizar', () => {
  assert.equal(typeof updater.canSelfUpdate(), 'boolean');
});
