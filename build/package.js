// Empacota o LimitBar:
//   node build/package.js          -> dist/LimitBar-win32-x64/LimitBar.exe (padrão, não precisa de Node pra rodar)
//   node build/package.js linux    -> dist/LimitBar-linux-x64/LimitBar
const { packager } = require('@electron/packager');
const { execFileSync } = require('child_process');
const path = require('path');

const platform = process.argv[2] || 'win32';

// Se o LimitBar empacotado estiver aberto, o executável fica travado e o packager
// falha ao tentar apagar a pasta (EBIJSY no Windows). Fecha antes.
if (platform === 'win32' && process.platform === 'win32') {
  try { execFileSync('taskkill', ['/F', '/IM', 'LimitBar.exe', '/T']); } catch { /* não estava rodando */ }
}

packager({
  dir: path.join(__dirname, '..'),
  name: 'LimitBar',
  out: path.join(__dirname, '..', 'dist'),
  platform,
  arch: 'x64',
  // .ico só existe/faz sentido no Windows; no Linux o ícone vem do .png (usado também pela bandeja em runtime)
  icon: platform === 'win32' ? path.join(__dirname, 'icon.ico') : path.join(__dirname, 'icon.png'),
  overwrite: true,
  prune: true,
  // signal-hook.js é chamado como processo standalone (node puro) pelos hooks do Claude Code/Codex,
  // que não conseguem ler dentro do .asar; precisa estar fora do arquivo, junto do signals.js que ele importa.
  asar: { unpack: '**/lib/{signal-hook,signals}.js' },
  ignore: [/^\/docs/, /^\/dist/, /^\/\.git/, /^\/build\/(make-icon\.js|icon\.html|package\.js)/, /^\/iniciar\.vbs/, /^\/instalar\.ps1/, /^\/instalar\.sh/, /^\/tests/, /^\/scripts/, /^\/\.github/, /^\/CHANGELOG\.md/],
  // win32metadata só é aplicado pelo packager quando platform é win32; inofensivo nos outros.
  win32metadata: { ProductName: 'LimitBar', FileDescription: 'Limites do Claude e do Codex na barra de tarefas' },
}).then((p) => console.log('pronto:', p.join(', '))).catch((e) => { console.error(e); process.exit(1); });
