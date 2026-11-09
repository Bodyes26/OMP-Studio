#!/bin/sh
# Installa OMP Studio su Linux x64 come AppImage, senza permessi di amministratore.
#
#   curl -fsSL https://raw.githubusercontent.com/Bodyes26/OMP-Studio/main/scripts/install-linux.sh | sh
#   ... | sh -s -- --nightly    canale Nightly
#
# Perche' l'AppImage e non il .deb: Studio si aggiorna da solo sostituendo il file
# indicato da $APPIMAGE, quindi serve un file scrivibile dall'utente. Con il .deb
# ogni aggiornamento passa dal gestore pacchetti e chiede la password.
set -eu

REPO="Bodyes26/OMP-Studio"
API="https://api.github.com/repos/$REPO/releases"

channel="${OMP_STUDIO_CHANNEL:-stable}"
while [ $# -gt 0 ]; do
	case "$1" in
		--nightly) channel="nightly" ;;
		--stable) channel="stable" ;;
		-h | --help)
			echo "Usage: install-linux.sh [--nightly]"
			exit 0
			;;
		*) echo "Unknown option: $1" >&2; exit 2 ;;
	esac
	shift
done

die() { echo "Error: $*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || die "this script is for Linux. On macOS use install-macos.sh."
case "$(uname -m)" in
	x86_64 | amd64) ;;
	*) die "OMP Studio is published for x86_64 only (this machine is $(uname -m))." ;;
esac
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required (coreutils)"

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
app_dir="$data_home/omp-studio"
appimage="$app_dir/OMP-Studio.AppImage"
bin_dir="$HOME/.local/bin"
desktop_file="$data_home/applications/sh.omp.studio.desktop"
icon_file="$data_home/icons/hicolor/128x128/apps/sh.omp.studio.png"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

fetch() { curl -fsSL --retry 3 -H "Accept: application/vnd.github+json" "$1"; }

echo "Looking up the latest $channel release..."
if [ "$channel" = "nightly" ]; then
	# L'elenco degli asset servito per tag puo' essere vecchio di minuti e puntare
	# a file gia' sostituiti: la release letta per id e' sempre aggiornata.
	fetch "$API/tags/nightly" >"$work/tag.json" || die "no Nightly release found"
	release_url="$(grep -o "\"url\": *\"$API/[0-9]*\"" "$work/tag.json" | head -n 1 | grep -o 'https://[^"]*')"
	[ -n "$release_url" ] || die "no Nightly release found"
	fetch "$release_url" >"$work/release.json" || die "cannot read the Nightly release"
else
	fetch "$API/latest" >"$work/release.json" || die "no stable release found"
fi

grep -o '"browser_download_url": *"[^"]*"' "$work/release.json" | grep -o 'https://[^"]*' >"$work/assets.txt" || true
tag="$(grep -o '"tag_name": *"[^"]*"' "$work/release.json" | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')"
appimage_url="$(grep '_amd64\.AppImage$' "$work/assets.txt" | head -n 1)"
sums_url="$(grep '/SHA256SUMS\.txt$' "$work/assets.txt" | head -n 1)"
[ -n "$appimage_url" ] || die "release $tag has no Linux AppImage. Try again later or use the other channel."
[ -n "$sums_url" ] || die "release $tag has no SHA256SUMS.txt"
appimage_name="${appimage_url##*/}"

echo "Downloading $appimage_name ($tag)..."
curl -fL --retry 3 --progress-bar -o "$work/$appimage_name" "$appimage_url"
curl -fsSL --retry 3 -o "$work/SHA256SUMS.txt" "$sums_url"

# sha256sum scrive "nome", "*nome" (binario) o "./nome" se lanciato su "./*".
expected="$(awk -v n="$appimage_name" '{ f = $2; sub(/^\*/, "", f); sub(/^\.\//, "", f) } f == n { print $1; exit }' "$work/SHA256SUMS.txt")"
[ -n "$expected" ] || die "$appimage_name is not listed in SHA256SUMS.txt"
actual="$(sha256sum "$work/$appimage_name" | awk '{ print $1 }')"
[ "$expected" = "$actual" ] || die "checksum mismatch for $appimage_name (expected $expected, got $actual)"

mkdir -p "$app_dir" "$bin_dir" "$(dirname "$desktop_file")" "$(dirname "$icon_file")"
# Copia nella stessa cartella e rename: un'istanza gia' aperta continua a usare
# il vecchio inode, e il percorso stabile e' quello che l'aggiornamento sostituira'.
cp "$work/$appimage_name" "$appimage.new"
chmod 755 "$appimage.new"
mv -f "$appimage.new" "$appimage"
ln -sf "$appimage" "$bin_dir/omp-studio"

# L'icona e' quella del commit della release, non quella di main.
curl -fsSL --retry 3 -o "$icon_file" \
	"https://raw.githubusercontent.com/$REPO/$tag/src-tauri/icons/128x128.png" \
	|| echo "Warning: icon not downloaded; the menu entry will use a generic icon." >&2

cat >"$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=OMP Studio
Comment=Desktop workspace for the omp coding agent
Exec="$appimage" %F
Icon=sh.omp.studio
Terminal=false
Categories=Development;IDE;
StartupNotify=true
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$desktop_file")" >/dev/null 2>&1 || true

echo "OMP Studio $tag installed in $appimage"
echo "Start it from the application menu or with: omp-studio"
case ":$PATH:" in
	*":$bin_dir:"*) ;;
	*) echo "Note: $bin_dir is not in PATH; add it to use the omp-studio command." ;;
esac
# Le AppImage di tipo 2 si montano con FUSE 2: senza libfuse2 non partono.
# Su Debian /sbin non e' nel PATH di un utente normale.
if ! { { ldconfig -p 2>/dev/null || /sbin/ldconfig -p 2>/dev/null; } | grep -q 'libfuse\.so\.2'; }; then
	echo "Note: libfuse2 seems missing; AppImages need it (Debian/Ubuntu: sudo apt install libfuse2t64, or libfuse2 on older releases)."
fi
