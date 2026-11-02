// projects/limitbar/lib/atomic-write.js
// Escrita atômica compartilhada pelos dois caminhos que mexem em configuração do usuário
// (settings.json do Claude Code e config.toml do Codex): grava num temporário e renomeia,
// para nunca deixar o arquivo original pela metade se algo falhar no meio.
const fs = require('fs');
const path = require('path');

function writeAtomic(file, text) {
  const tmp = `${file}.limitbar-${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Caminhos de scripts chamados como processo standalone (node puro, fora do Electron) precisam
// apontar para fora do .asar: um "node" comum não sabe ler dentro do arquivo empacotado, só o
// próprio Electron sabe. O packager copia esses arquivos para "app.asar.unpacked" ao lado (ver
// build/package.js, asar.unpack); em dev, sem .asar no caminho, isto não muda nada.
const unpackedPath = (p) => p.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);

module.exports = { writeAtomic, unpackedPath };
