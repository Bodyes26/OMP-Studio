#!/bin/bash
# Installa OMP Studio su macOS senza passare dal browser.
#
#   curl -fsSL https://raw.githubusercontent.com/Bodyes26/OMP-Studio/main/scripts/install-macos.sh | bash
#   ... | bash -s -- --nightly            canale Nightly
#   ... | bash -s -- --dir ~/Applications cartella di destinazione
#
# Perche' uno script: Studio non e' notarizzato da Apple. Gatekeeper controlla solo
# i file con l'attributo com.apple.quarantine, che mettono browser e Mail ma non
# curl/hdiutil/ditto. Gli aggiornamenti successivi li fa Studio, con lo stesso metodo.
set -euo pipefail

REPO="Bodyes26/OMP-Studio"
BUNDLE_ID="sh.omp.studio"
APP_NAME="OMP Studio.app"
API="https://api.github.com/repos/$REPO/releases"

channel="${OMP_STUDIO_CHANNEL:-stable}"
dest_dir="${OMP_STUDIO_INSTALL_DIR:-}"
while [ $# -gt 0 ]; do
	case "$1" in
		--nightly) channel="nightly" ;;
		--stable) channel="stable" ;;
		--dir) dest_dir="${2:?--dir requires a path}"; shift ;;
		-h | --help)
			echo "Usage: install-macos.sh [--nightly] [--dir <folder>]"
			exit 0
			;;
		*) echo "Unknown option: $1" >&2; exit 2 ;;
	esac
	shift
done

die() { echo "Error: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this script is for macOS. On Linux use install-linux.sh."

# /Applications e' scrivibile solo dagli amministratori: per un utente standard
# si ripiega su ~/Applications, che Launchpad e Spotlight indicizzano lo stesso.
if [ -z "$dest_dir" ]; then
	if [ -w /Applications ]; then dest_dir="/Applications"; else dest_dir="$HOME/Applications"; fi
fi
mkdir -p "$dest_dir" || die "cannot create $dest_dir"
dest_dir="$(cd "$dest_dir" && pwd)"
dest="$dest_dir/$APP_NAME"

# Studio aperto da quella cartella: sostituirne il bundle sotto i piedi lo
# farebbe cadere al primo file caricato in modo pigro.
if pgrep -f "$dest/Contents/MacOS/" >/dev/null 2>&1; then
	die "OMP Studio is running from $dest. Quit it and run the installer again."
fi

work="$(mktemp -d -t omp-studio-install)"
mount_point="$work/mount"
cleanup() {
	hdiutil detach -force "$mount_point" >/dev/null 2>&1 || true
	rm -rf "$work"
}
trap cleanup EXIT

fetch() { curl -fsSL --retry 3 -H "Accept: application/vnd.github+json" "$1"; }

echo "Looking up the latest $channel release..."
if [ "$channel" = "nightly" ]; then
	# L'elenco degli asset servito per tag puo' essere vecchio di minuti e puntare
	# a file gia' sostituiti: la release letta per id e' sempre aggiornata.
	release_url="$(fetch "$API/tags/nightly" | grep -m1 -o "\"url\": *\"$API/[0-9]*\"" | grep -o 'https://[^"]*')" \
		|| die "no Nightly release found"
	fetch "$release_url" >"$work/release.json"
else
	fetch "$API/latest" >"$work/release.json" || die "no stable release found"
fi

asset_urls="$(grep -o '"browser_download_url": *"[^"]*"' "$work/release.json" | grep -o 'https://[^"]*')"
tag="$(grep -m1 -o '"tag_name": *"[^"]*"' "$work/release.json" | sed 's/.*"\([^"]*\)"$/\1/')"

# Il DMG universale va bene ovunque; la Nightly compilata in locale ha solo
# quello dell'architettura della macchina che l'ha prodotta.
case "$(uname -m)" in
	arm64) arch_suffix="_aarch64.dmg" ;;
	*) arch_suffix="_x64.dmg" ;;
esac
dmg_url="$(echo "$asset_urls" | grep -m1 "_universal\.dmg$" || echo "$asset_urls" | grep -m1 "$arch_suffix$" || true)"
[ -n "$dmg_url" ] || die "release $tag has no macOS installer for $(uname -m). Try again later or use the other channel."
sums_url="$(echo "$asset_urls" | grep -m1 "/SHA256SUMS\.txt$" || true)"
[ -n "$sums_url" ] || die "release $tag has no SHA256SUMS.txt"
dmg_name="${dmg_url##*/}"

echo "Downloading $dmg_name ($tag)..."
curl -fL --retry 3 --progress-bar -o "$work/$dmg_name" "$dmg_url"
curl -fsSL --retry 3 -o "$work/SHA256SUMS.txt" "$sums_url"

# sha256sum scrive "nome", "*nome" (binario) o "./nome" se lanciato su "./*".
expected="$(awk -v n="$dmg_name" '{ f = $2; sub(/^\*/, "", f); sub(/^\.\//, "", f) } f == n { print $1; exit }' "$work/SHA256SUMS.txt")"
[ -n "$expected" ] || die "$dmg_name is not listed in SHA256SUMS.txt"
actual="$(shasum -a 256 "$work/$dmg_name" | awk '{ print $1 }')"
[ "$expected" = "$actual" ] || die "checksum mismatch for $dmg_name (expected $expected, got $actual)"

mkdir -p "$mount_point"
# hdiutil su macOS recenti avvisa che attach e' deprecato: il messaggio serve solo se fallisce.
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mount_point" "$work/$dmg_name" >/dev/null 2>"$work/attach.log" \
	|| { cat "$work/attach.log" >&2; die "cannot mount $dmg_name"; }
[ -d "$mount_point/$APP_NAME" ] || die "$APP_NAME not found in $dmg_name"
found_id="$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$mount_point/$APP_NAME/Contents/Info.plist")"
[ "$found_id" = "$BUNDLE_ID" ] || die "the disk image contains $found_id instead of $BUNDLE_ID"

# Copia accanto alla destinazione e poi scambio con rename: se qualcosa va
# storto resta installata la versione precedente.
staged="$dest_dir/.omp-studio-install-$$.app"
backup="$dest_dir/.omp-studio-previous-$$.app"
rm -rf "$staged"
ditto "$mount_point/$APP_NAME" "$staged" || { rm -rf "$staged"; die "cannot copy into $dest_dir"; }
xattr -dr com.apple.quarantine "$staged" 2>/dev/null || true

if [ -e "$dest" ]; then
	mv "$dest" "$backup" || { rm -rf "$staged"; die "cannot replace $dest"; }
fi
if ! mv "$staged" "$dest"; then
	[ -e "$backup" ] && mv "$backup" "$dest"
	rm -rf "$staged"
	die "cannot install into $dest"
fi
rm -rf "$backup"

version="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$dest/Contents/Info.plist" 2>/dev/null || echo "$tag")"
echo "OMP Studio $version installed in $dest"
echo "Open it from Launchpad or with: open \"$dest\""
