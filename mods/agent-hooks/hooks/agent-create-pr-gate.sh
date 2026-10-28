#!/usr/bin/env bash
set -uo pipefail
# PreToolUse gate: gh pr create requires the agent-pr marker written by agent-create-pr-mark.sh.

input="$(cat)"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || true)"
case "$command" in
  *"gh pr create"*) : ;;
  *) exit 0 ;;
esac

session_id="$(printf '%s' "$input" | jq -r '.session_id // ""' 2>/dev/null || true)"
[[ -z "$session_id" || -f "/tmp/claude-agent-pr/${session_id}" ]] && exit 0

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "gh pr create was run without invoking the agent-pr skill first this session. Invoke the agent-pr skill, then retry gh pr create."
  }
}'
exit 0
