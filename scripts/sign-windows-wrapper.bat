# Wrapper batch per la firma Windows di Tauri (compatibile con NSIS !finalize / !uninstfinalize).
# NSIS invoca questo wrapper passando un singolo argomento percorso (%1 o %~1).
@echo off
setlocal
set TARGET_FILE=%~1
if "%TARGET_FILE%"=="" (
    echo [sign-wrapper] Nessun file specificato da firmare.
    exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $p = $args[0]; $s = @('scripts/sign-windows.ps1', '../scripts/sign-windows.ps1') | Where-Object { Test-Path $_ } | Select-Object -First 1; if (-not $s) { throw 'scripts/sign-windows.ps1 non trovato' }; & $s -Path $p }" "%TARGET_FILE%"
exit /b %ERRORLEVEL%
