@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ========================================================
echo   Antigravity Theme Studio - Install / Update
echo ========================================================
echo.

call :FIND_NODE
if "%NODE_BIN%"=="" (
    echo [ERROR] Node.js 18+ not found. Please install Node.js and retry.
    if "%~1"=="" pause
    exit /b 1
)

echo [INFO] Node: %NODE_BIN%
set "ARGS=--kill --relaunch"
if not "%~1"=="" set "ARGS=%*"
"%NODE_BIN%" setup.cjs %ARGS%
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" (
    echo [FAILED] Exit code: %ERR%
)
if "%~1"=="" pause
exit /b %ERR%

:FIND_NODE
set "NODE_BIN="
for /f "delims=" %%i in ('where node 2^>nul') do (
    if "!NODE_BIN!"=="" set "NODE_BIN=%%i"
)
if not "%NODE_BIN%"=="" goto :EOF

if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_BIN=C:\Program Files\nodejs\node.exe"
    goto :EOF
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE_BIN=%LOCALAPPDATA%\Programs\nodejs\node.exe"
    goto :EOF
)
if exist "%USERPROFILE%\scoop\shims\node.exe" (
    set "NODE_BIN=%USERPROFILE%\scoop\shims\node.exe"
    goto :EOF
)

for /f "usebackq delims=" %%n in (`powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $p=Join-Path $env:USERPROFILE '.gemini\config\plugins\gemini-neko-cockpit\sidecars\neko-cockpit\sidecar.json'; if(Test-Path $p){$c=(Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json).command; if($c -and (Test-Path $c)){Write-Output $c}}" 2^>nul`) do (
    if "!NODE_BIN!"=="" set "NODE_BIN=%%n"
)
if not "%NODE_BIN%"=="" goto :EOF

if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" (
    set "ELECTRON_RUN_AS_NODE=1"
    set "NODE_BIN=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
    goto :EOF
)
if exist "C:\Program Files\Antigravity\Antigravity.exe" (
    set "ELECTRON_RUN_AS_NODE=1"
    set "NODE_BIN=C:\Program Files\Antigravity\Antigravity.exe"
    goto :EOF
)
goto :EOF
