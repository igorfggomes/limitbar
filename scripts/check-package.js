// Confere o conteúdo do app empacotado: tem tudo que precisa e não leva testes, scripts, CI nem docs.
//   node scripts/check-package.js   (depois de npm run package)
const path = require('path');

const root = path.join(__dirname, '..');
const asar = require(require.resolve('@electron/asar', { paths: [root] }));
const file = path.join(root, 'dist', 'LimitBar-win32-x64', 'resources', 'app.asar');

let list;
try { list = asar.listPackage(file).map((p) => p.replace(/\\/g, '/')); } catch (e) {
  console.error(`Não foi possível ler ${file}: ${e.message}`);
  process.exit(1);
}

const must = ['/main.js', '/preload.js', '/index.html', '/dock.html', '/providers.js', '/updater.js', '/package.json',
  '/lib/pace.js', '/lib/alerts.js', '/lib/version.js', '/build/icon.ico'];
const leak = ['/tests', '/scripts', '/.github', '/CHANGELOG.md', '/docs', '/dist'];

const missing = must.filter((m) => !list.includes(m));
const leaked = leak.filter((m) => list.some((p) => p === m || p.startsWith(m + '/')));
if (missing.length) console.error('Faltando no pacote:', missing.join(', '));
if (leaked.length) console.error('Não deveriam estar no pacote:', leaked.join(', '));
if (missing.length || leaked.length) process.exit(1);
console.log(`Pacote ok: ${list.length} arquivos, nada faltando e nada sobrando.`);
