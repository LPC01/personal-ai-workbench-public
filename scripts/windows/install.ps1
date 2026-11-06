# Install personal-ai-workbench on Windows.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/install.ps1
# Responsibility: initialize the data dir (separate from program dir); data is kept on uninstall.

param(
  # Program (install) directory
  [string]$TargetDir = "$env:LOCALAPPDATA\personal-ai-workbench",
  # Data directory (SQLite / Artifact / Extensions / Backups / Memory export)
  [string]$DataDir = "$env:LOCALAPPDATA\personal-ai-workbench-data"
)

$ErrorActionPreference = 'Stop'

Write-Host "== personal-ai-workbench install =="
Write-Host "Program dir: $TargetDir"
Write-Host "Data dir:    $DataDir"

# 1. Program dir: keep if it already exists (treated as upgrade)
if (-not (Test-Path $TargetDir)) {
  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
  Write-Host "[install] program dir created"
} else {
  Write-Host "[install] program dir exists (keep)"
}

# 2. Data dir: create subdirs (db / artifacts / extensions / backups)
foreach ($sub in @('artifacts', 'extensions', 'backups')) {
  $p = Join-Path $DataDir $sub
  if (-not (Test-Path $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
  }
}
Write-Host "[install] data dir ready"

# 3. Write data-dir marker (for upgrade/uninstall to recognize)
$marker = Join-Path $DataDir '.workbench-data'
Set-Content -Path $marker -Value ("version=0.1.0`ncreated=" + (Get-Date -Format o)) -Encoding UTF8

Write-Host "[install] done. Set WB_DATA_DIR=$DataDir before launching."
