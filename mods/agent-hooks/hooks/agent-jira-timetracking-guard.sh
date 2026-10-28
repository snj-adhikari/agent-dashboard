#!/usr/bin/env bash
set -uo pipefail
# Estimates and worklogs belong on Dev subtasks only: a key is allowed once it has been seen as a Dev subtask (created or fetched); every other timetracking write is denied.

CACHE="$HOME/.claude/state/jira-dev-subtasks.txt"
mkdir -p "${CACHE%/*}" && touch "$CACHE"

input=$(cat)
event=$(jq -r '.hook_event_name // empty' <<<"$input" 2>/dev/null)
tool=$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null)
TT='test("timetracking|originalEstimate|remainingEstimate|timeoriginalestimate|timeestimate"; "i")'

remember() { [[ -n "$1" ]] && ! grep -qx "$1" "$CACHE" && echo "$1" >>"$CACHE"; return 0; }

if [[ "$event" == "PostToolUse" ]]; then
  resp=$(jq -r '.tool_response
    | if type == "string" then .
      elif type == "array" then map(.text? // empty) | join("")
      elif type == "object" and has("content") then (.content | map(.text? // empty) | join(""))
      else tojson end' <<<"$input" 2>/dev/null)
  case "$tool" in
    *createJiraIssue)
      [[ "$(jq -r '.tool_input.issueType // ""' <<<"$input")" == "Dev subtask" ]] || exit 0
      remember "$(jq -r '(.data // .) | (.issues.nodes[0].key? // .key) // empty' <<<"$resp" 2>/dev/null)" ;;
    *getJiraIssue|*searchJiraIssuesUsingJql)
      jq -r '(.data // .) | (if (.issues | type) == "object" then .issues.nodes[]? elif has("issues") then .issues[] else . end)
        | (., .fields.subtasks[]?)
        | select(.fields.issuetype.name? == "Dev subtask") | .key // empty' <<<"$resp" 2>/dev/null \
        | while read -r k; do remember "$k"; done ;;
  esac
  exit 0
fi

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}
MSG="Worklogs and estimates go on the Dev subtask only — never on the parent Story/Task/Bug/Epic. Find the Dev subtask (getJiraIssue on the parent → subtasks, or getJiraIssue on the target to confirm its type is Dev subtask) and log there."

case "$tool" in
  *createJiraIssue)
    touches=$(jq -r "[.tool_input.additional_fields // {} | keys[] | select($TT)] | length" <<<"$input" 2>/dev/null)
    [[ "${touches:-0}" -gt 0 ]] || exit 0
    [[ "$(jq -r '.tool_input.issueType // ""' <<<"$input")" == "Dev subtask" ]] || deny "Estimate on a new $(jq -r '.tool_input.issueType // "issue"' <<<"$input"). $MSG"
    exit 0 ;;
  *editJiraIssue)
    touches=$(jq -r "[(.tool_input.fields // {}), (.tool_input.additional_fields // {}) | keys[] | select($TT)] | length" <<<"$input" 2>/dev/null)
    [[ "${touches:-0}" -gt 0 ]] || exit 0
    key=$(jq -r '.tool_input.issueIdOrKey // empty' <<<"$input") ;;
  *executeWrite)
    [[ "$(jq -r '.tool_input.name // ""' <<<"$input")" == "addOrEditJiraIssueWorklog" ]] || exit 0
    key=$(jq -r '.tool_input.inputs.issueIdOrKey // empty' <<<"$input") ;;
  *addWorklogToJiraIssue)
    key=$(jq -r '.tool_input.issueIdOrKey // empty' <<<"$input") ;;
  *) exit 0 ;;
esac

key=${key##*/}
grep -qx "$key" "$CACHE" || deny "${key:-Unknown issue} is not a confirmed Dev subtask. $MSG"
exit 0
