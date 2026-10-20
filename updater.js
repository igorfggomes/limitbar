// Atualização automática: consulta as Releases do GitHub, baixa o zip, confere o SHA-256 e troca os
// arquivos do app por um script externo (o .exe em uso não pode se sobrescrever).
const { app } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = 'igorfggomes/limitbar';
// LIMITBAR_UPDATE_URL existe só para testar o fluxo contra um servidor local
const API = process.env.LIMITBAR_UPDATE_URL || `https://api.github.com/repos/${REPO}/releases/latest`;
const TRUSTED_PREFIX = process.env.LIMITBAR_UPDATE_URL ? null : `https://github.com/${REPO}/releases/download/`;
const UA = () => `LimitBar/${app.getVersion()}`;

const parts = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
function isNewer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// só dá para trocar os arquivos se for o app empacotado e a pasta for gravável (não em Arquivos de Programas)
function canSelfUpdate() {
  if (!app.isPackaged && !process.env.LIMITBAR_FORCE_SELF_UPDATE) return false;
  try { fs.accessSync(path.dirname(process.execPath), fs.constants.W_OK); return true; } catch { return false; }
}

// devolve null se já está na versão mais recente
async function check() {
  const res = await fetch(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': UA() },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub respondeu HTTP ${res.status}`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/i, '');
  if (!version || !isNewer(version, app.getVersion())) return null;
  const asset = (rel.assets || []).find((a) => /win32-x64\.zip$/i.test(a.name));
  return {
    version, page: rel.html_url, notes: rel.body || '',
    assetUrl: asset ? asset.browser_download_url : null,
    size: asset ? asset.size : 0,
    sha256: asset && /^sha256:/.test(asset.digest || '') ? asset.digest.slice(7) : null,
  };
}

async function download(info, onProgress) {
  if (TRUSTED_PREFIX && !info.assetUrl.startsWith(TRUSTED_PREFIX)) throw new Error('Origem do download não confiável');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'limitbar-update-'));
  const file = path.join(dir, 'LimitBar-win32-x64.zip');
  try {
    const res = await fetch(info.assetUrl, { headers: { 'User-Agent': UA() } });
    if (!res.ok || !res.body) throw new Error(`Download falhou (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || info.size || 0;
    const hash = crypto.createHash('sha256'), out = fs.createWriteStream(file), reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value); got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (onProgress && total) onProgress(Math.min(1, got / total));
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    if (info.sha256 && hash.digest('hex') !== info.sha256) throw new Error('Arquivo corrompido (o SHA-256 não confere)');
    return file;
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

// Espera o app fechar, guarda a pasta atual como backup, copia a versão nova e reabre.
// Se algo falhar, devolve a versão antiga e reabre o app mesmo assim.
const SCRIPT = `param([int]$ProcId, [string]$Zip, [string]$Dest, [string]$Exe)
$log = Join-Path $env:TEMP 'limitbar-update.log'
function Log($m) { "$(Get-Date -Format s) $m" | Add-Content $log }
try {
  Log "inicio: pid=$ProcId dest=$Dest"
  try { Wait-Process -Id $ProcId -Timeout 30 -ErrorAction SilentlyContinue } catch {}
  Get-Process LimitBar -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe } | Stop-Process -Force
  Start-Sleep -Seconds 1
  $tmp = Join-Path $env:TEMP ('limitbar-extract-' + [guid]::NewGuid())
  Expand-Archive -LiteralPath $Zip -DestinationPath $tmp -Force
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (-not $src -or -not (Test-Path (Join-Path $src.FullName 'LimitBar.exe'))) { throw 'zip sem LimitBar.exe' }
  $bak = "$Dest.bak"
  if (Test-Path $bak) { Remove-Item $bak -Recurse -Force }
  Move-Item -LiteralPath $Dest -Destination $bak
  try {
    New-Item -ItemType Directory -Force $Dest | Out-Null
    robocopy $src.FullName $Dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy $LASTEXITCODE" }
    Remove-Item $bak -Recurse -Force
    Log 'atualizado'
  } catch {
    Log "falhou, restaurando backup: $_"
    if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
    Move-Item -LiteralPath $bak -Destination $Dest
  }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item (Split-Path $Zip) -Recurse -Force -ErrorAction SilentlyContinue
} catch { Log "erro: $_" }
Start-Process $Exe
`;

function apply(zipPath) {
  const script = path.join(os.tmpdir(), 'limitbar-update.ps1');
  fs.writeFileSync(script, '﻿' + SCRIPT, 'utf8'); // BOM: o PowerShell 5.1 lê acentos corretamente
  // "cmd /c start /B" solta o script do app: um filho direto do Electron morre junto com ele no Windows
  // (e o PowerShell 5.1 não inicia com detached: true, pois precisa de console)
  const child = spawn('cmd.exe', [
    '/c', 'start', '/B', '', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
    '-ProcId', String(process.pid), '-Zip', zipPath, '-Dest', path.dirname(process.execPath), '-Exe', process.execPath,
  ], { stdio: 'ignore', windowsHide: true });
  const log = path.join(os.tmpdir(), 'limitbar-update.log');
  const note = (m) => fs.appendFileSync(log, `${new Date().toISOString()} ${m}\n`);
  child.on('error', (e) => note(`falha ao iniciar o script: ${e.message}`));
  note(`script iniciado (pid ${child.pid})`);
  child.unref();
}

module.exports = { check, download, apply, canSelfUpdate, isNewer };
