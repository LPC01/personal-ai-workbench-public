@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Personal AI Workbench - one-click start
echo ============================================
echo.

rem --- Pick a Node 22 (session-local PATH prepend; nothing is installed) -----
rem Explorer double-click inherits the interactive PATH, which on some machines
rem only contains a newer Node. Scan the well-known toolchain locations for a
rem Node 22 and prepend it for THIS session only. WB_NODE_HOME wins if set.
rem The chosen folder is always printed, so the interpreter actually used stays
rem auditable - never a silent switch. Keep this list in sync with the one in
rem scripts/start.mjs (guarded by tests/contract/node-version-pin.test.ts).
set "WB_NODE_FOUND="

call :try_node "%WB_NODE_HOME%"
call :try_node "%NVM_SYMLINK%"
for /d %%d in ("%NVM_HOME%\v22*") do call :try_node "%%~fd"
for /d %%d in ("%APPDATA%\nvm\v22*") do call :try_node "%%~fd"
for /d %%d in ("%USERPROFILE%\.fnm\node-versions\v22*") do call :try_node "%%~fd\installation"
for /d %%d in ("%USERPROFILE%\.asdf\installs\nodejs\22*") do call :try_node "%%~fd"
for /d %%d in ("%LOCALAPPDATA%\Volta\tools\image\node\22*") do call :try_node "%%~fd"
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\22*") do call :try_node "%%~fd"
call :try_node "%ProgramFiles%\nodejs22"
call :try_node "%LOCALAPPDATA%\Programs\nodejs22"

if defined WB_NODE_FOUND (
  set "PATH=%WB_NODE_FOUND%;%PATH%"
  echo [node] Node 22 selected: %WB_NODE_FOUND%
  echo.
)

rem --- Node version gate ---------------------------------------------------
rem This workbench loads a native SQLite module (better-sqlite3) built for
rem Node 22 (ABI 127). Other major versions fail later with ERR_DLOPEN_FAILED,
rem so fail fast here with a readable message. Keep 22 in sync with
rem package.json engines / .nvmrc / scripts/start.mjs.
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found on PATH.
  echo         Install Node 22, or set WB_NODE_HOME to a folder that already
  echo         contains node.exe ^(Node 22^), then run this script again.
  echo.
  pause
  exit /b 1
)

for /f "delims=. tokens=1" %%v in ('node -v') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if not "%NODE_MAJOR%"=="22" (
  echo [ERROR] Node 22 is required, but found Node %NODE_MAJOR%.
  echo.
  echo         better-sqlite3 is a native module whose binary is compiled against
  echo         a specific Node ABI. This repo is installed for Node 22 ^(ABI 127^);
  echo         other major versions fail with ERR_DLOPEN_FAILED when opening the DB.
  echo.
  echo         Already searched for Node 22 in: WB_NODE_HOME, NVM_SYMLINK, NVM_HOME,
  echo         AppData\nvm, .fnm, .asdf, Volta, and user-level toolchain folders.
  echo.
  echo         Fix: install Node 22, or set WB_NODE_HOME to an existing Node 22
  echo              folder, then run this script again.
  echo         Note: WB_ALLOW_NODE_MISMATCH=1 only skips this check - it does NOT
  echo               fix the ABI mismatch, so the database will still fail to open.
  echo.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] pnpm not found.
  echo         Install Node 22 and pnpm 10 first, then retry.
  echo         Docs: https://pnpm.io/installation
  echo.
  pause
  exit /b 1
)

call pnpm start
set RC=%ERRORLEVEL%

echo.
if not "%RC%"=="0" (
  echo Workbench exited with code %RC%.
) else (
  echo Workbench stopped.
)
pause
exit /b %RC%

rem --- helper: %1 = candidate folder; sets WB_NODE_FOUND when it holds Node 22 -
:try_node
setlocal enabledelayedexpansion
if "%~1"=="" ( endlocal & exit /b 0 )
if defined WB_NODE_FOUND ( endlocal & exit /b 0 )
if not exist "%~1\node.exe" ( endlocal & exit /b 0 )
set "MAJ="
for /f "delims=. tokens=1" %%v in ('"%~1\node.exe" -v 2^>nul') do set "MAJ=%%v"
set "MAJ=!MAJ:v=!"
if "!MAJ!"=="22" ( endlocal & set "WB_NODE_FOUND=%~1" & exit /b 0 )
endlocal
exit /b 0
