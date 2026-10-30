#!/usr/bin/env bash
# usage: doctor.sh [android|ios|safari|chrome|iphone|all]  (read-only; prints READY / NOT READY and the steps to run yourself)
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app/Contents/Developer ]; then export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer; fi

have() { command -v "$1" >/dev/null 2>&1; }
status() { printf '\n== %s: %s\n' "$1" "$2"; }
step() { printf '  - %s\n' "$*"; }

check_node() { have node || step "install Node 18+ (needed for the inject proxy): brew install node"; }

android() {
  if ! have adb; then
    status "Android (real device, Chrome)" "NOT READY"
    step "install adb: brew install --cask android-platform-tools"
    step "then rerun: doctor.sh android"
    return
  fi
  local states; states=$(timeout 10 adb devices 2>/dev/null | awk 'NR > 1 && NF { print $2 }' | sort -u)
  if grep -qx device <<<"$states"; then
    status "Android (real device, Chrome)" "READY"
    step "keep the phone unlocked with Chrome open (locked = black screenshots, zero-height elements)"
    have agent-browser || step "install agent-browser to control Chrome over CDP: npm i -g agent-browser"
  elif grep -qx unauthorized <<<"$states"; then
    status "Android (real device, Chrome)" "NOT READY (unauthorised)"
    step "unlock the phone and tap Allow on the 'Allow USB debugging?' prompt (tick Always allow)"
    step "no prompt: unplug, Developer options > Revoke USB debugging authorisations, plug in again"
  else
    status "Android (real device, Chrome)" "NOT READY (${states:-no device})"
    step "phone: Settings > About phone > tap Build number 7 times"
    step "Settings > System > Developer options > USB debugging on"
    step "plug in by USB (data cable), unlock, tap Allow; check: adb devices shows 'device'"
  fi
}

ios() {
  if ! [ -d /Applications/Xcode.app ] || ! have xcrun; then
    status "iOS simulator (Safari)" "NOT READY (no Xcode)"
    step "install Xcode from the App Store, open it once and accept the licence"
    return
  fi
  if ! timeout 30 xcrun simctl list runtimes 2>/dev/null | grep -q '^iOS'; then
    local free; free=$(df -k / | awk 'NR == 2 { print int($4 / 1048576) }')
    status "iOS simulator (Safari)" "NOT READY (no iOS runtime)"
    step "free disk on /: ${free} GB; the iOS runtime download is ~8.5 GB"
    [ "${free:-0}" -lt 10 ] && step "WARNING: under 10 GB free, clear space before installing"
    step "run: xcodebuild -downloadPlatform iOS   (or Xcode > Settings > Components)"
    return
  fi
  status "iOS simulator (Safari)" "READY"
  local booted; booted=$(timeout 30 xcrun simctl list devices booted 2>/dev/null | grep -E '\(Booted\)' | head -1 | sed 's/^ *//')
  if [ -n "$booted" ]; then step "booted: $booted"; else step "no simulator booted; ios.sh iboot boots one"; fi
  check_node
}

safari() {
  if ! [ -d /Applications/Safari.app ]; then status "Safari (Mac)" "NOT READY (no Safari)"; return; fi
  status "Safari (Mac)" "READY (proxy route)"
  step "proxy route needs nothing else: inject-proxy.mjs + safari.sh"
  step "WebDriver route only: run yourself 'sudo safaridriver --enable', then Safari > Develop > Allow Remote Automation"
  check_node
}

chrome() {
  if have agent-browser; then
    status "Chrome (Mac, responsive widths)" "READY"
  else
    status "Chrome (Mac, responsive widths)" "NOT READY"
    step "install agent-browser: npm i -g agent-browser && agent-browser install"
  fi
}

iphone() {
  status "Real iPhone (Web Inspector)" "MANUAL"
  step "iPhone: Settings > Apps > Safari > Advanced > Web Inspector on"
  step "connect by cable, unlock, tap Trust"
  step "Mac Safari: Settings > Advanced > Show features for web developers"
  step "Safari > Develop > <your iPhone> > the page > Console; paste logger.js"
  step "phone reaches the dev server on the same Wi-Fi: http://<mac-ip>:<port>"
}

for t in timeout jq; do have "$t" || { status "Prerequisite: $t" "MISSING"; step "the helpers need it: brew install coreutils jq"; }; done

case "${1:-all}" in
  android|ios|safari|chrome|iphone) "$1" ;;
  all) android; ios; safari; chrome; iphone ;;
  *) echo "usage: doctor.sh [android|ios|safari|chrome|iphone|all]" ;;
esac
exit 0
