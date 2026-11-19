#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/macos"
ASSETS="$ROOT/assets"
DIST="$ROOT/dist"
VERSION="${CUCKOO_VERSION:-0.0.0}"
BUNDLE_ID="dev.nightwalker.agent-cuckoo"
EXE="AgentCuckoo"
APP_NAME="agent-cuckoo"
WORK="$DIST/macos-build"
APP="$WORK/$APP_NAME.app"
DMG="$DIST/$APP_NAME-$VERSION-macos-universal.dmg"

rm -rf "$WORK" "$DMG"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

BINS=()
for arch in arm64 x86_64; do
  triple="$arch-apple-macosx13.0"
  swift build --package-path "$PKG" -c release --triple "$triple" --product "$EXE"
  BINS+=("$(swift build --package-path "$PKG" -c release --triple "$triple" --show-bin-path)/$EXE")
done
lipo -create "${BINS[@]}" -output "$APP/Contents/MacOS/$EXE"
lipo -info "$APP/Contents/MacOS/$EXE"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>agent-cuckoo</string>
  <key>CFBundleExecutable</key><string>$EXE</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Snj - nightwalker</string>
  <key>NSAppleEventsUsageDescription</key><string>agent-cuckoo reads Mail headers, controls Music and Spotify, and opens composers only when you turn those cards on. It never sends for you.</string>
  <key>NSMicrophoneUsageDescription</key><string>agent-cuckoo listens for dictation, the wake phrase and Notetaker only after you turn them on.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>agent-cuckoo transcribes dictation, the wake phrase and notes on this Mac.</string>
  <key>NSScreenCaptureUsageDescription</key><string>agent-cuckoo captures screenshots you ask for and Notetaker system audio when you allow it.</string>
</dict>
</plist>
PLIST

ICON="$ASSETS/icon.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [[ ! -f "$ICON" ]]; then
  echo "assets/icon.svg missing, using a placeholder icon"
  ICON="$TMP/icon.svg"
  cat > "$ICON" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect x="64" y="64" width="896" height="896" rx="200" fill="#7c3aed"/>
  <rect x="380" y="240" width="40" height="560" rx="20" fill="#ffffff"/>
  <path d="M420 260 L700 340 L420 440 Z" fill="#ffffff"/>
</svg>
SVG
fi
if qlmanage -t -s 1024 -o "$TMP" "$ICON" >/dev/null 2>&1 && [[ -f "$TMP/$(basename "$ICON").png" ]]; then
  SET="$TMP/AppIcon.iconset"
  mkdir -p "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$TMP/$(basename "$ICON").png" --out "$SET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$TMP/$(basename "$ICON").png" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
else
  echo "icon render failed, building without an app icon" >&2
fi

LOCK="$ASSETS/emoji.lock"
if [[ -f "$LOCK" ]]; then
  COMMIT="$(sed -nE 's/^commit[[:space:]=:]+([0-9a-f]{7,40}).*/\1/p' "$LOCK" | head -1)"
  if [[ -z "$COMMIT" ]]; then
    echo "emoji.lock has no commit line, skipping emoji fetch" >&2
  else
    RAW="https://raw.githubusercontent.com/microsoft/fluentui-emoji/$COMMIT"
    OUT="$APP/Contents/Resources/emoji"
    mkdir -p "$OUT"
    curl -fsSL "$RAW/LICENSE" -o "$OUT/LICENSE"
    while read -r name path || [[ -n "$name" ]]; do
      [[ -z "$name" || "$name" == \#* || "$name" == commit* || -z "$path" ]] && continue
      curl -fsSL "$RAW/${path// /%20}" -o "$OUT/$name.${path##*.}"
    done < "$LOCK"
  fi
else
  echo "assets/emoji.lock missing, skipping emoji fetch (system emoji used)"
fi

for dir in mascot sounds; do
  if compgen -G "$ASSETS/$dir/*" >/dev/null; then
    mkdir -p "$APP/Contents/Resources/$dir"
    find "$ASSETS/$dir" -maxdepth 1 -type f \( -name '*.png' -o -name '*.wav' -o -name '*.ogg' -o -name '*.m4a' -o -name 'License.txt' \) -exec cp {} "$APP/Contents/Resources/$dir/" \;
  fi
done
cp "$ASSETS/whats-new.json" "$APP/Contents/Resources/whats-new.json"
mkdir -p "$APP/Contents/Resources/i18n"
cp "$ROOT"/i18n/*.json "$APP/Contents/Resources/i18n/"
echo "bundled resources:"
(cd "$APP/Contents/Resources" && find . -type f | sort)

codesign --force --deep -s "${CUCKOO_SIGN_IDENTITY:--}" "$APP"

STAGE="$TMP/dmg"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "agent-cuckoo $VERSION" -srcfolder "$STAGE" -format UDZO -ov "$DMG" >/dev/null
rm -rf "$WORK"
echo "built $DMG"
