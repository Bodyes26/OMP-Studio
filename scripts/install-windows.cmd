@echo off
rem Installa OMP Studio su Windows senza passare dal browser.
rem
rem   cmd /c "curl -fsSLo %TEMP%\omp-studio-install.cmd https://raw.githubusercontent.com/Bodyes26/OMP-Studio/main/scripts/install-windows.cmd && %TEMP%\omp-studio-install.cmd"
rem   aggiungere --nightly dopo l'ultimo .cmd per il canale Nightly
rem
rem Perche' uno script: SmartScreen controlla solo i file con il Mark of the Web
rem (lo stream Zone.Identifier), che i browser aggiungono e curl.exe no.
rem Niente PowerShell: bastano curl.exe, findstr e certutil, presenti da Windows 10 1803.
rem Il file va tenuto con terminatori CRLF (vedi .gitattributes): con LF cmd
rem sbaglia i salti alle etichette.
setlocal EnableExtensions DisableDelayedExpansion

set "REPO=Bodyes26/OMP-Studio"
set "API=https://api.github.com/repos/%REPO%/releases"
set "CHANNEL=stable"
if /i "%OMP_STUDIO_CHANNEL%"=="nightly" set "CHANNEL=nightly"
if /i "%~1"=="--nightly" set "CHANNEL=nightly"
if /i "%~1"=="--stable" set "CHANNEL=stable"

where curl.exe >nul 2>&1 || (echo Error: curl.exe not found. Windows 10 version 1803 or later is required. & exit /b 1)

rem Con Studio aperto l'installer silenzioso non puo' sostituire l'eseguibile.
tasklist /fi "imagename eq omp-studio-app.exe" /nh 2>nul | find /i "omp-studio-app.exe" >nul && (echo Error: OMP Studio is running. Quit it and run the installer again. & exit /b 1)

set "WORK=%TEMP%\omp-studio-install-%RANDOM%%RANDOM%"
mkdir "%WORK%" || exit /b 1

echo Looking up the latest %CHANNEL% release...
if /i "%CHANNEL%"=="nightly" goto :nightly
curl -fsSL --retry 3 -H "Accept: application/vnd.github+json" -o "%WORK%\release.json" "%API%/latest" || (call :fail "no stable release found" & exit /b 1)
goto :assets

:nightly
rem L'elenco degli asset servito per tag puo' essere vecchio di minuti e puntare a
rem file gia' sostituiti: la release letta per id e' sempre aggiornata. Nel JSON
rem la prima chiave "url" e' quella della release.
curl -fsSL --retry 3 -H "Accept: application/vnd.github+json" -o "%WORK%\tag.json" "%API%/tags/nightly" || (call :fail "no Nightly release found" & exit /b 1)
set "RELEASE_URL="
for /f tokens^=4^ delims^=^" %%U in ('findstr /l /c:"\"url\":" "%WORK%\tag.json"') do if not defined RELEASE_URL set "RELEASE_URL=%%U"
if not defined RELEASE_URL (call :fail "no Nightly release found" & exit /b 1)
curl -fsSL --retry 3 -H "Accept: application/vnd.github+json" -o "%WORK%\release.json" "%RELEASE_URL%" || (call :fail "cannot read the Nightly release" & exit /b 1)

:assets
set "EXE_URL="
set "SUMS_URL="
for /f tokens^=4^ delims^=^" %%U in ('findstr /l /c:"\"browser_download_url\":" "%WORK%\release.json"') do call :pick "%%U"
if not defined EXE_URL (call :fail "this release has no Windows installer. Try again later or use the other channel." & exit /b 1)
if not defined SUMS_URL (call :fail "this release has no SHA256SUMS.txt" & exit /b 1)
rem Ultimo segmento dell'URL: ogni "/" diventa un separatore di lista.
for %%A in ("%EXE_URL:/=" "%") do set "EXE_NAME=%%~A"

echo Downloading %EXE_NAME%...
curl -fL --retry 3 --progress-bar -o "%WORK%\%EXE_NAME%" "%EXE_URL%" || (call :fail "download failed" & exit /b 1)
curl -fsSL --retry 3 -o "%WORK%\SHA256SUMS.txt" "%SUMS_URL%" || (call :fail "cannot download SHA256SUMS.txt" & exit /b 1)

set "EXPECTED="
for /f "tokens=1" %%H in ('findstr /l /c:"%EXE_NAME%" "%WORK%\SHA256SUMS.txt"') do if not defined EXPECTED set "EXPECTED=%%H"
if not defined EXPECTED (call :fail "%EXE_NAME% is not listed in SHA256SUMS.txt" & exit /b 1)
rem certutil stampa l'hash sulla seconda riga; le versioni vecchie separano i byte con spazi.
set "ACTUAL="
for /f "skip=1 delims=" %%H in ('certutil -hashfile "%WORK%\%EXE_NAME%" SHA256') do if not defined ACTUAL set "ACTUAL=%%H"
set "ACTUAL=%ACTUAL: =%"
if /i not "%EXPECTED%"=="%ACTUAL%" (call :fail "checksum mismatch for %EXE_NAME%" & exit /b 1)

echo Installing...
rem /S: installazione silenziosa per l'utente corrente, senza diritti di amministratore.
start "" /wait "%WORK%\%EXE_NAME%" /S
if errorlevel 1 (call :fail "the installer exited with code %errorlevel%" & exit /b 1)

rmdir /s /q "%WORK%" 2>nul
echo OMP Studio installed. Start it from the Start menu.
exit /b 0

:pick
set "U=%~1"
if /i "%U:~-14%"=="_x64-setup.exe" if not defined EXE_URL set "EXE_URL=%U%"
if /i "%U:~-15%"=="/SHA256SUMS.txt" if not defined SUMS_URL set "SUMS_URL=%U%"
exit /b 0

:fail
echo Error: %~1
rmdir /s /q "%WORK%" 2>nul
exit /b 1
