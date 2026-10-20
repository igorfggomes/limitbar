// Empacota o LimitBar em dist/LimitBar-win32-x64/LimitBar.exe (não precisa de Node para rodar)
const { packager } = require('@electron/packager');
const path = require('path');

packager({
  dir: path.join(__dirname, '..'),
  name: 'LimitBar',
  out: path.join(__dirname, '..', 'dist'),
  platform: 'win32',
  arch: 'x64',
  icon: path.join(__dirname, 'icon.ico'),
  overwrite: true,
  prune: true,
  asar: true,
  ignore: [/^\/docs/, /^\/dist/, /^\/\.git/, /^\/build\/(make-icon\.js|icon\.html|package\.js)/, /^\/iniciar\.vbs/, /^\/instalar\.ps1/, /^\/tests/, /^\/scripts/, /^\/\.github/, /^\/CHANGELOG\.md/],
  win32metadata: { ProductName: 'LimitBar', FileDescription: 'Limites do Claude e do Codex na barra de tarefas' },
}).then((p) => console.log('pronto:', p.join(', '))).catch((e) => { console.error(e); process.exit(1); });
