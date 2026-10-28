#!/usr/bin/env bash
set -uo pipefail
# PostToolUse marker for agent-pr skill runs; read by agent-create-pr-gate.sh. Always exits 0.

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null || true)"
[[ "$tool_name" == "Skill" ]] || exit 0

skill="$(printf '%s' "$input" | jq -r '.tool_input.skill // ""' 2>/dev/null || true)"
[[ "$skill" == "agent-pr" || "$skill" == *":agent-pr" ]] || exit 0

session_id="$(printf '%s' "$input" | jq -r '.session_id // ""' 2>/dev/null || true)"
[[ -z "$session_id" ]] && exit 0

mkdir -p /tmp/claude-agent-pr 2>/dev/null || true
touch "/tmp/claude-agent-pr/${session_id}" 2>/dev/null || true

exit 0
