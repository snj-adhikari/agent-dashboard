#!/usr/bin/env python3
"""AWS stays read-only for Claude: the production read/write profile and the credentials file are user-only (deny), and the aws CLI in Bash needs approval since lookups belong on the read-only aws-mcp profiles."""
import json
import os
import re
import sys

PROFILE = re.compile(r"(?<![\w-])" + re.escape(os.environ.get("AGENT_AWS_RW_PROFILE", "prod-rw")) + r"(?![\w-])")
CREDENTIALS = re.compile(r"\.aws/credentials\b")
AWS_CLI = re.compile(r"(?:^|[;&|(\n]|\$\()\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:sudo\s+)?(?:\S*/)?aws(?:\s|$)")

data = json.load(sys.stdin)
tool = data.get("tool_name", "")
inp = data.get("tool_input", {}) or {}
cmd = inp.get("command", "") if tool == "Bash" else ""


def decide(decision, reason):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision, "permissionDecisionReason": reason}}))
    sys.exit(0)


if tool == "Bash":
    user_only = bool(PROFILE.search(cmd) or CREDENTIALS.search(cmd))
elif tool in ("Read", "Edit", "Write", "Grep", "Glob"):
    user_only = bool(CREDENTIALS.search(inp.get("file_path", "") or inp.get("path", "") or ""))
elif tool.startswith("mcp__aws-mcp__"):
    user_only = bool(PROFILE.search(json.dumps(inp)))
else:
    user_only = False

if user_only:
    decide("deny", "The production read/write AWS profile and ~/.aws/credentials are user-only. Don't run it: give the user the exact command to run themselves with the ! prefix.")

if AWS_CLI.search(cmd):
    decide("ask", "AWS lookups go through the read-only aws-mcp profiles, not the aws CLI. For writes, give the user the command to run with !. Approve only if this CLI call is really needed.")
