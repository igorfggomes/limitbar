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

module.exports = { writeAtomic };
