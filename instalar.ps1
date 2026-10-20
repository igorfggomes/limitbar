# Instala o LimitBar como um programa do Windows:
#   - empacota o app (LimitBar.exe, sem precisar de Node para rodar)
#   - copia para %LOCALAPPDATA%\Programs\LimitBar
#   - cria atalhos na Área de Trabalho e no Menu Iniciar
# Uso: powershell -ExecutionPolicy Bypass -File instalar.ps1
param([string]$Destino = "$env:LOCALAPPDATA\Programs\LimitBar", [switch]$SemAtalhoDesktop)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '1/4 Instalando dependências...'
npm install --no-audit --no-fund | Out-Null
Write-Host '2/4 Empacotando o app...'
npm run package --silent
$origem = Join-Path $PSScriptRoot 'dist\LimitBar-win32-x64'
if (-not (Test-Path "$origem\LimitBar.exe")) { throw 'Empacotamento falhou: LimitBar.exe não encontrado.' }

Write-Host "3/4 Copiando para $Destino ..."
Get-Process LimitBar -ErrorAction SilentlyContinue | Stop-Process -Force   # fecha uma versão já aberta
Start-Sleep -Milliseconds 500
New-Item -ItemType Directory -Force $Destino | Out-Null
robocopy $origem $Destino /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar (robocopy $LASTEXITCODE)" }

Write-Host '4/4 Criando atalhos...'
$exe = Join-Path $Destino 'LimitBar.exe'
$sh = New-Object -ComObject WScript.Shell
$locais = @(Join-Path ([Environment]::GetFolderPath('Programs')) 'LimitBar.lnk')
if (-not $SemAtalhoDesktop) { $locais += Join-Path ([Environment]::GetFolderPath('Desktop')) 'LimitBar.lnk' }
foreach ($l in $locais) {
  $a = $sh.CreateShortcut($l); $a.TargetPath = $exe; $a.WorkingDirectory = $Destino
  $a.IconLocation = "$exe,0"; $a.Description = 'Limites do Claude e do Codex na barra de tarefas'; $a.Save()
}
Write-Host "`nPronto! Abra o LimitBar pelo Menu Iniciar ou pela Área de Trabalho."
Start-Process $exe
