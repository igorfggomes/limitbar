// projects/limitbar/lib/autostart.js
// app.setLoginItemSettings (Electron) só funciona no Windows e no macOS; no Linux é um no-op
// silencioso. Aqui a gente escreve/apaga o .desktop em ~/.config/autostart, que é o padrão XDG
// seguido por GNOME, KDE, XFCE etc.
const fs = require('fs');
const os = require('os');
const path = require('path');

const autostartDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart');
const desktopFilePath = () => path.join(autostartDir(), 'limitbar.desktop');

function isEnabledLinux() {
  return fs.existsSync(desktopFilePath());
}

function setEnabledLinux(enabled, execPath) {
  const file = desktopFilePath();
  if (!enabled) { try { fs.unlinkSync(file); } catch { /* já não existia */ } return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=LimitBar',
    `Exec=${execPath}`,
    'X-GNOME-Autostart-enabled=true',
    'NoDisplay=false',
    '',
  ].join('\n');
  fs.writeFileSync(file, entry);
}

module.exports = { desktopFilePath, isEnabledLinux, setEnabledLinux };
