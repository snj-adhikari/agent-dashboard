#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$APP_DIR/tauri"
ASSETS="$APP_DIR/assets"
DIST="$APP_DIR/dist"
VERSION="${CUCKOO_VERSION:-0.0.0}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$TAURI_DIR"
npm ci --no-audit --no-fund

ICON="$ASSETS/icon.svg"
if [[ ! -f "$ICON" ]]; then
  echo "assets/icon.svg missing, using a placeholder icon"
  ICON="$WORK/placeholder.svg"
  cat > "$ICON" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="224" fill="#17171f"/>
  <circle cx="512" cy="560" r="300" fill="#7c3aed"/>
  <rect x="600" y="180" width="28" height="420" fill="#f2f2f5"/>
  <path d="M628 190 L840 260 L628 330 Z" fill="#f59e0b"/>
</svg>
SVG
fi
npx tauri icon "$ICON" -o src-tauri/icons

EMOJI_OUT="$TAURI_DIR/public/emoji"
rm -rf "$EMOJI_OUT"
LOCK="$ASSETS/emoji.lock"
if [[ -f "$LOCK" ]]; then
  COMMIT="$(sed -nE 's/^commit[[:space:]=:]+([0-9a-f]{7,40}).*/\1/p' "$LOCK" | head -1)"
  if [[ -z "$COMMIT" ]]; then
    echo "emoji.lock has no commit line, skipping emoji fetch" >&2
  else
    RAW="https://raw.githubusercontent.com/microsoft/fluentui-emoji/$COMMIT"
    mkdir -p "$EMOJI_OUT"
    curl -fsSL "$RAW/LICENSE" -o "$EMOJI_OUT/LICENSE"
    INDEX="{"
    while read -r name path; do
      path="${path%$'\r'}"
      [[ -z "$name" || "$name" == \#* || "$name" == commit* || -z "$path" ]] && continue
      file="$name.${path##*.}"
      curl -fsSL "$RAW/${path// /%20}" -o "$EMOJI_OUT/$file"
      INDEX+="\"$name\":\"$file\","
    done < "$LOCK"
    printf '%s}\n' "${INDEX%,}" > "$EMOJI_OUT/index.json"
  fi
else
  echo "assets/emoji.lock missing, skipping emoji fetch (system emoji used)"
fi

for dir in mascot sounds; do
  rm -rf "$TAURI_DIR/public/$dir"
  if compgen -G "$ASSETS/$dir/*" >/dev/null; then
    mkdir -p "$TAURI_DIR/public/$dir"
    find "$ASSETS/$dir" -maxdepth 1 -type f \( -name '*.png' -o -name '*.wav' -o -name '*.ogg' -o -name '*.m4a' -o -name 'License.txt' \) -exec cp {} "$TAURI_DIR/public/$dir/" \;
  fi
done
echo "bundled public files:"
(cd "$TAURI_DIR/public" && find . -type f | sort)

case "$(uname -s)" in
  Darwin) BUNDLES="app" ;;
  Linux) BUNDLES="appimage,deb" ;;
  *) BUNDLES="nsis,msi" ;;
esac
npx tauri build --bundles "$BUNDLES" --config "{\"version\":\"$VERSION\"}"

BUNDLE_DIR="$TAURI_DIR/src-tauri/target/release/bundle"
mkdir -p "$DIST"
find "$BUNDLE_DIR" -maxdepth 2 -type f \( -name '*.AppImage' -o -name '*.deb' -o -name '*.msi' -o -name '*.exe' -o -name '*.dmg' \) -exec cp {} "$DIST/" \;
for app in "$BUNDLE_DIR"/macos/*.app; do
  if [[ -d "$app" ]]; then ditto -c -k --norsrc --keepParent "$app" "$DIST/agent-cuckoo-$VERSION-tauri-macos.zip"; fi
done
echo "Tauri bundles in $BUNDLE_DIR"
ls "$DIST" 2>/dev/null || true
