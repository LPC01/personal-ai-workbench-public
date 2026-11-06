# Upgrade personal-ai-workbench on Windows.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/upgrade.ps1
# Responsibility: back up current data, then program is replaced by the packaging flow; data is kept.

param(
  [string]$DataDir = "$env:LOCALAPPDATA\personal-ai-workbench-data"
)

$ErrorActionPreference = 'Stop'

Write-Host "== personal-ai-workbench upgrade =="

if (-not (Test-Path $DataDir)) {
  Write-Error "Data dir not found: $DataDir (run install.ps1 first)"
  exit 1
}

# 1. Pre-upgrade backup of data (no plaintext credentials are stored in data dir)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $DataDir "backups\pre-upgrade-$stamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

foreach ($name in @('workbench.db', 'artifacts', 'extensions')) {
  $src = Join-Path $DataDir $name
  if (Test-Path $src) {
    Copy-Item -Path $src -Destination $backupDir -Recurse -Force
  }
}
Write-Host "[upgrade] data backed up to $backupDir"

# 2. Record upgrade marker; new version auto-upgrades schema via one-way migrations on first start
$marker = Join-Path $DataDir '.workbench-data'
Add-Content -Path $marker -Value ("upgraded=" + (Get-Date -Format o)) -Encoding UTF8

Write-Host "[upgrade] done. Data is kept; schema upgrades automatically on first start."
