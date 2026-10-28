#!/usr/bin/env python3
"""Guard real-browser loads of the production sites in AGENT_PROD_HOSTS (comma-separated domains): JS execution fires GTM/ad impressions that Google flags as bot traffic.

- GTA - Blocker extension not active -> ask on every route; never allowed automatically.
- Claude in Chrome with the extension active -> ask each load, until the user says "allow all" (or similar) in chat;
  that unlocks prod loads for the rest of the session.
- agent-browser etc. with --extension -> ask: the extension only acts on "claude" tab groups, which those drivers don't create.
- Claude in Chrome: the extension must be installed and enabled in a local Chrome profile.
- agent-browser and other drivers: the command must pass --extension <path to the GTA - Blocker folder>.
Plain HTTP (curl, WebFetch) is allowed.
"""
import glob
import importlib.util
import json
import os
import re
import shlex
import sys

DOMAINS = [re.escape(d.strip()) for d in os.environ.get("AGENT_PROD_HOSTS", "").split(",") if d.strip()]
if not DOMAINS:
    sys.exit(0)
HOST = re.compile(r"(?<![@\w.-])(?:https?://)?(?:[a-z0-9-]+\.)*(?:" + "|".join(DOMAINS) + r")(?![\w-])", re.I)
BROWSER_TOOLS = re.compile(r"\b(agent-browser|playwright|puppeteer|lighthouse|chromium|google-chrome|selenium|cypress)\b", re.I)
BLOCKER_NAME = "GTA - Blocker"
CHROME_DIR = os.path.expanduser("~/Library/Application Support/Google/Chrome")
UNLOCK_DIR = os.path.expanduser("~/.claude/state/prod-browse-unlocked")
ALLOW_ALL = re.compile(r"\b(allow|run|do|check|test)\s+(it\s+)?(for\s+)?(them\s+)?all\b|\bdon'?t\s+ask\b|\bno\s+need\s+to\s+ask\b", re.I)
NEGATED_ALL = re.compile(r"\b(don'?t|do\s+not|never|not)\s+(allow|run|do|check|test)\s+(for\s+)?all\b", re.I)


def latest_human_message(transcript):
    """Reuses the push gate's transcript reader so both hooks agree on what counts as a human message."""
    try:
        spec = importlib.util.spec_from_file_location("agent_push_gate", os.path.join(os.path.dirname(__file__), "agent-push-gate.py"))
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        return gate.last_turns(transcript)[0] or ""
    except Exception:
        return ""


def session_unlocked(session_id, transcript):
    if not session_id:
        return False
    marker = os.path.join(UNLOCK_DIR, re.sub(r"[^\w-]", "", session_id))
    if os.path.exists(marker):
        return True
    human = latest_human_message(transcript) if transcript else ""
    if ALLOW_ALL.search(human) and not NEGATED_ALL.search(human):
        os.makedirs(UNLOCK_DIR, exist_ok=True)
        open(marker, "w").close()
        return True
    return False


def is_blocker(path):
    try:
        with open(os.path.join(os.path.expanduser(path), "manifest.json")) as f:
            return json.load(f).get("name") == BLOCKER_NAME
    except (OSError, ValueError):
        return False


def chrome_blocker_active():
    for prefs in glob.glob(os.path.join(CHROME_DIR, "*", "Secure Preferences")):
        try:
            with open(prefs) as f:
                settings = json.load(f).get("extensions", {}).get("settings", {}) or {}
        except (OSError, ValueError):
            continue
        for ext in settings.values():
            enabled = not ext.get("disable_reasons") and ext.get("state", 1) != 0
            if enabled and is_blocker(ext.get("path", "")):
                return True
    return False


def command_loads_blocker(cmd):
    try:
        args = shlex.split(cmd)
    except ValueError:
        return False
    return any(a == "--extension" and i + 1 < len(args) and is_blocker(args[i + 1]) for i, a in enumerate(args))


def decide(decision, reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }))


data = json.load(sys.stdin)
tool = data.get("tool_name", "")
inp = data.get("tool_input", {}) or {}

if tool == "Bash":
    cmd = inp.get("command", "")
    if BROWSER_TOOLS.search(cmd) and HOST.search(cmd):
        if command_loads_blocker(cmd):
            decide("ask", "Prod site in a browser with GTA - Blocker loaded via --extension. Approve only if the user asked for this prod load.")
        else:
            decide("ask", "Prod site in a browser WITHOUT GTA - Blocker fires GTM/ad impressions. Approve only this route, only if the user explicitly asked for it.")
elif tool.startswith("mcp__claude-in-chrome__") and HOST.search(json.dumps(inp)):
    if not chrome_blocker_active():
        decide("ask", "GTA - Blocker is NOT active in Chrome, so this prod site load fires GTM/ad impressions. Approve only this route, only if the user explicitly asked for it.")
    elif session_unlocked(data.get("session_id", ""), data.get("transcript_path", "")):
        decide("allow", "Prod site in Claude in Chrome: GTA - Blocker active and the user allowed all prod loads this session.")
    else:
        decide("ask", "Prod site in Claude in Chrome with GTA - Blocker active. Approve this one load, or reply 'allow all' to stop asking for the rest of this session.")
