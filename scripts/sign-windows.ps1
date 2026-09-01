# Firma Authenticode dei binari Windows durante `tauri build`.
#
# Tauri invoca questo script per l'eseguibile dell'app e per l'installer NSIS,
# passando il percorso del file al posto di `%1` (vedi `bundle.windows.signCommand`
# in `src-tauri/tauri.windows.conf.json`).
#
# Senza certificato lo script non firma e lo dichiara: la build resta possibile
# per le prerelease/dev, mentre il workflow di release stabile verifica la firma e
# rifiuta di pubblicare un installer non firmato.

param(
	[Parameter(Mandatory = $true)]
	[string]$Path
)

$ErrorActionPreference = 'Stop'

# Sanitizza e normalizza il percorso ricevuto
$cleanPath = $Path.Trim().Trim('"', "'")
if ([string]::IsNullOrWhiteSpace($cleanPath)) {
	throw "sign-windows: percorso del file vuoto o non specificato."
}

if (-not (Test-Path -LiteralPath $cleanPath)) {
	throw "sign-windows: file da firmare non trovato al percorso '$cleanPath'."
}

$resolvedPath = (Resolve-Path -LiteralPath $cleanPath).Path

$thumbprint = $env:WINDOWS_CERTIFICATE_THUMBPRINT
if ([string]::IsNullOrWhiteSpace($thumbprint)) {
	Write-Output "sign-windows: nessun certificato configurato, '$resolvedPath' resta non firmato."
	exit 0
}

$timestampUrl = if ([string]::IsNullOrWhiteSpace($env:WINDOWS_TIMESTAMP_URL)) {
	'http://timestamp.digicert.com'
} else {
	$env:WINDOWS_TIMESTAMP_URL
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
	# I runner GitHub hanno signtool nel Windows SDK, non nel PATH.
	$signtool = Get-ChildItem -Path 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter 'signtool.exe' -Recurse -ErrorAction SilentlyContinue |
		Where-Object { $_.FullName -match 'x64' } |
		Sort-Object FullName -Descending |
		Select-Object -First 1
	if (-not $signtool) {
		throw "signtool.exe non trovato: impossibile firmare '$resolvedPath'."
	}
	$signtoolPath = $signtool.FullName
} else {
	$signtoolPath = $signtool.Source
}

Write-Output "sign-windows: firmo '$resolvedPath' con l'impronta $thumbprint..."
& $signtoolPath sign /fd sha256 /td sha256 /tr $timestampUrl /sha1 $thumbprint "$resolvedPath"
if ($LASTEXITCODE -ne 0) {
	throw "signtool ha restituito codice di uscita $LASTEXITCODE per '$resolvedPath'."
}

# Verifica post-firma del binario/installer
$signature = Get-AuthenticodeSignature -LiteralPath $resolvedPath
if ($signature.Status -ne 'Valid') {
	throw "Verifica firma Authenticode fallita per '$resolvedPath': $($signature.StatusMessage) (Status: $($signature.Status))"
}

Write-Output "sign-windows: firma Authenticode verificata con successo per '$resolvedPath' ($($signature.Status))."
