#!/bin/bash
# Prepara sul runner macOS un keychain con il certificato di firma di Studio
# (secret APPLE_CERTIFICATE in base64 + APPLE_CERTIFICATE_PASSWORD).
#
# Non si usa l'import di Tauri via APPLE_CERTIFICATE: Tauri cerca solo le identita'
# che macOS considera valide e quella self-signed non lo e' ("failed to resolve
# signing identity"), mentre codesign la usa senza problemi. Tauri trova poi
# l'identita' indicata in APPLE_SIGNING_IDENTITY nella lista dei keychain.
set -euo pipefail

if [ -z "${APPLE_CERTIFICATE:-}" ]; then
	echo "Nessun certificato macOS (APPLE_CERTIFICATE assente): resta la firma ad-hoc."
	exit 0
fi

keychain="${RUNNER_TEMP:?}/omp-signing.keychain-db"
keychain_password="$(openssl rand -hex 24)"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
echo "$APPLE_CERTIFICATE" | base64 --decode >"$RUNNER_TEMP/signing.p12"
security import "$RUNNER_TEMP/signing.p12" -k "$keychain" -P "${APPLE_CERTIFICATE_PASSWORD:-}" -T /usr/bin/codesign
rm -f "$RUNNER_TEMP/signing.p12"
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
# shellcheck disable=SC2046 # la lista esistente va spezzata in argomenti
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
security find-identity -p codesigning "$keychain"
