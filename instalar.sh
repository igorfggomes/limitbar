#!/usr/bin/env bash
# Instala o LimitBar no Linux:
#   - empacota o app (LimitBar, sem precisar de Node para rodar)
#   - copia para ~/.local/opt/LimitBar
#   - cria entrada no menu de aplicativos (~/.local/share/applications)
# Uso: bash instalar.sh [destino]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

DESTINO="${1:-$HOME/.local/opt/LimitBar}"

echo "1/4 Instalando dependências..."
npm install --no-audit --no-fund >/dev/null

echo "2/4 Empacotando o app..."
pkill -f "$DESTINO/LimitBar" 2>/dev/null || true
npm run package:linux --silent
ORIGEM="dist/LimitBar-linux-x64"
[ -f "$ORIGEM/LimitBar" ] || { echo "Empacotamento falhou: LimitBar não encontrado." >&2; exit 1; }

echo "3/4 Copiando para $DESTINO ..."
mkdir -p "$DESTINO"
rsync -a --delete "$ORIGEM/" "$DESTINO/"
chmod +x "$DESTINO/LimitBar"
cp build/icon.png "$DESTINO/icon.png" # fora do .asar, pra entrada do menu poder ler o ícone

echo "4/4 Criando entrada no menu de aplicativos..."
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/limitbar.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=LimitBar
Comment=Limites do Claude e do Codex na bandeja do sistema
Exec=$DESTINO/LimitBar
Icon=$DESTINO/icon.png
Terminal=false
Categories=Utility;
EOF

echo
echo "Pronto! Abra o LimitBar pelo menu de aplicativos ou rode: $DESTINO/LimitBar"
