#!/bin/bash
# Usage: relay.sh <target> <message>. Logs the relay, then types <message> into the target tab key by key and presses Enter.
# <target> is a Herdr app terminal (t30) or, inside herdr, a pane id (logged as <HERDR_SESSION>-<pane>).
set -euo pipefail
export LC_ALL=C
target=${1:-}
msg=$(printf '%s' "${2:?message}" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')
case "$target" in '' | */* | .*) echo "relay: bad target '$target'" >&2; exit 2 ;; esac
herdr=
if [ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_SESSION:-}" ]; then herdr=1; fi
key=$target
if [ -n "$herdr" ]; then key="$HERDR_SESSION-$target"; fi
key=$(printf '%s' "$key" | tr -c 'A-Za-z0-9_.:-' '_')
from=$(printf '%s' "${HC_TERMINAL_ID:-${HERDR_PANE_ID:-factory-lead}}" | tr -cd 'A-Za-z0-9_.:-')
sum=$(printf '%s' "$msg" | shasum -a 256 | cut -d' ' -f1)
dir="$HOME/.claude/agent-relays"
umask 077
mkdir -p "$dir" && chmod 700 "$dir"
printf '{"ts": %s, "from": "%s", "sha256": "%s"}\n' "$(date +%s)" "$from" "$sum" >> "$dir/$key.jsonl"
chmod 600 "$dir/$key.jsonl"

if [ -n "$herdr" ]; then
  for ((i = 0; i < ${#msg}; i++)); do
    herdr pane send-text "$target" "${msg:i:1}" > /dev/null
    sleep 0.03
  done
  herdr pane send-keys "$target" enter > /dev/null
  exit 0
fi

# hc keys types only unshifted keys and capitals; the rest of the message from the first other character is pasted by hc send.
i=0
while [ "$i" -lt "${#msg}" ]; do
  c=${msg:i:1}
  case "$c" in
    [A-Z]) k="shift+$(printf '%s' "$c" | tr 'A-Z' 'a-z')" ;;
    ' ') k=space ;;
    [a-z0-9] | , | . | / | "'" | '`' | = | ';' | '\' | '[' | ']' | -) k=$c ;;
    *) break ;;
  esac
  hc keys "$target" "$k" > /dev/null
  sleep 0.03
  i=$((i + 1))
done
if [ "$i" -lt "${#msg}" ]; then hc send "$target" "${msg:i}" > /dev/null; else hc keys "$target" enter > /dev/null; fi
