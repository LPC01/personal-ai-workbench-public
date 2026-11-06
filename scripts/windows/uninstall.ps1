# Uninstall personal-ai-workbench on Windows.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/uninstall.ps1 [-Purge]
# Responsibility: remove the program dir; data dir is kept by default, deleted only with -Purge.

param(
  [string]$TargetDir = "$env:LOCALAPPDATA\personal-ai-workbench",
  [string]$DataDir = "$env:LOCALAPPDATA\personal-ai-workbench-data",
  [switch]$Purge
)

$ErrorActionPreference = 'Stop'

Write-Host "== personal-ai-workbench uninstall =="

# 1. Remove program dir
if (Test-Path $TargetDir) {
  Remove-Item -Path $TargetDir -Recurse -Force
  Write-Host "[uninstall] program dir removed: $TargetDir"
} else {
  Write-Host "[uninstall] program dir not found (skip)"
}

# 2. Data dir: keep by default
if (-not $Purge) {
  Write-Host "[uninstall] data dir kept: $DataDir"
  Write-Host "[uninstall] to also remove data, run: uninstall.ps1 -Purge"
} else {
  if (Test-Path $DataDir) {
    Remove-Item -Path $DataDir -Recurse -Force
    Write-Host "[uninstall] data dir removed: $DataDir"
  } else {
    Write-Host "[uninstall] data dir not found (skip)"
  }
}

Write-Host "[uninstall] done."
