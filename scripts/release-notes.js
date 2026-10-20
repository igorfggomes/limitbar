// Extrai do CHANGELOG.md a seção de uma versão, para usar como notas da Release no GitHub.
//   node scripts/release-notes.js 1.3.0   ->  imprime as notas (sai com erro se a versão não existir)
const fs = require('fs');
const path = require('path');

// O CHANGELOG usa títulos "## 1.3.0 — 2026-10-20"; a seção vai até o próximo título "## ".
function extract(changelog, version) {
  const v = String(version).replace(/^v/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${v}(\\s|$)`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

if (require.main === module) {
  const version = process.argv[2];
  if (!version) { console.error('uso: node scripts/release-notes.js <versão>'); process.exit(2); }
  const notes = extract(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) { console.error(`CHANGELOG.md não tem uma seção para a versão ${version}`); process.exit(1); }
  process.stdout.write(notes + '\n');
}

module.exports = { extract };
