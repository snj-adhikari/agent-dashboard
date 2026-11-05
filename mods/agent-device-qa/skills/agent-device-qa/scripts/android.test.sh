#!/usr/bin/env bash
# usage: bash android.test.sh  (adb is stubbed; no device needed)
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export OUT="$T/out" ADB_LOG="$T/adb.log" FAKE_UI="$T/ui.xml"
cat > "$T/adb" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$ADB_LOG"
case "$*" in
  "shell wm size") printf 'Physical size: 1080x2400\nOverride size: 720x1600\n' ;;
  "shell cat /sdcard/adq-ui.xml") cat "$FAKE_UI" ;;
esac
EOF
chmod +x "$T/adb"
export PATH="$T:$PATH"
cat > "$FAKE_UI" <<'EOF'
<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" content-desc="" bounds="[0,0][720,1600]"><node index="1" text="Sign in" content-desc="" bounds="[100,200][300,260]" /><node index="2" text="" content-desc="Open menu" bounds="[600,40][680,120]" /></node></hierarchy>
EOF
source "$DIR/android.sh"

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2] want [$3]"; fail=1; fi; }
last() { tail -1 "$ADB_LOG"; }

check "_scale 0-1000 to pixels" "$(_scale 500 250 1080 2400)" "540 600"
check "anorm uses override size" "$(anorm 1000 500)" "720 800"
check "_ucentre by text" "$(_ucentre 'sign in' < "$FAKE_UI")" "200 230"
check "_ucentre by content-desc" "$(_ucentre 'menu' < "$FAKE_UI")" "640 80"
check "_ucentre no match" "$(_ucentre 'nope' < "$FAKE_UI")" ""
autap 'Open menu' >/dev/null
check "autap taps centre" "$(last)" "shell input tap 640 80"
autap 'nope' >/dev/null
check "autap no match returns 1" "$?" "1"
atype "a b&c"
check "atype escapes" "$(last)" 'shell input text a%sb\&c'
aswipe 10 20 30 40
check "aswipe default ms" "$(last)" "shell input swipe 10 20 30 40 300"
aswipe 10 20 30 40 800
check "aswipe ms" "$(last)" "shell input swipe 10 20 30 40 800"
alaunch com.example.app
check "alaunch" "$(last)" "shell monkey -p com.example.app -c android.intent.category.LAUNCHER 1"
exit $fail
