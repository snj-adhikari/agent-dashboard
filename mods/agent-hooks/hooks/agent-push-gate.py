#!/usr/bin/env python3
"""PreToolUse guard: git push and git commit need the user's explicit go-ahead in the latest human message."""
import json
import os
import re
import subprocess
import sys

HEREDOC = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n.*?\n\s*\1\b", re.S)
GATED = re.compile(r'(?:^|[;&|(\n])\s*(?:rtk\s+)?git\s+(?:-C\s+\S+\s+)?(push|commit)\b')
PUSH_INTENT = (
    r"\bpush(ed)?\b"
    r"|\bcommit\s+and\s+(pr|push)\b"
    r"|\b(create|creater|raise|open|make|update|add\s+on|add\s+to)\s+(the\s+|same\s+|a\s+|new\s+|on\s+same\s+)?(pr|pull\s+request)\b"
    r"|\bsame\s+pr\b|\bship\s+it\b"
)
INTENT = {'push': re.compile(PUSH_INTENT, re.I), 'commit': re.compile(PUSH_INTENT + r"|\bcommit(ted)?\b", re.I)}
NEGATED = re.compile(r"\b(don'?t|do\s+not|never|no|not\s+yet|without)\s+(\w+\s+)?(push|commit)", re.I)
AFFIRM = re.compile(r"^\s*(yes|y|yep|yeah|ok|okay|sure|go\s+ahead|do\s+it|please\s+do|proceed|approved?)\b", re.I)
TURN = re.compile(r'"type"\s*:\s*"(user|assistant|attachment)"')
SYNTHETIC = ('<system-reminder', '<task-notification', '<command-', 'Another Claude session', 'Base directory', '[Request interrupted', 'This session is being continued')


def human_text(entry):
    attachment = entry.get('attachment') or {}
    if entry.get('type') == 'attachment' and attachment.get('type') == 'queued_command':
        prompt = attachment.get('prompt')
        return prompt if isinstance(prompt, str) and not prompt.startswith(SYNTHETIC) else None
    if entry.get('type') != 'user' or entry.get('userType') != 'external' or entry.get('isMeta') or entry.get('toolUseResult') is not None:
        return None
    content = (entry.get('message') or {}).get('content')
    if isinstance(content, str):
        text = content
    elif isinstance(content, list) and not any(c.get('type') == 'tool_result' for c in content):
        text = ' '.join(c.get('text', '') for c in content if c.get('type') == 'text')
    else:
        return None
    return None if not text or text.startswith(SYNTHETIC) else text


def last_turns(path):
    human, assistant = None, ''
    with open(path, errors='ignore') as fh:
        for line in fh:
            if not TURN.search(line):
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            text = human_text(entry)
            if text:
                human = text
            elif entry.get('type') == 'assistant':
                parts = [c.get('text', '') for c in (entry.get('message') or {}).get('content') or [] if c.get('type') == 'text']
                if parts:
                    assistant = ' '.join(parts)
    return human, assistant


def run(args, cwd):
    try:
        return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=8).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ''


def target(command, verb, cwd):
    """Directory and branch the command applies to."""
    cd = re.search(r'(?:^|[;&|\n])\s*cd\s+"?([^\s"&;|]+)"?\s*&&', command)
    c_flag = re.search(r'git\s+-C\s+"?([^\s"]+)"?\s+(?:push|commit)', command)
    hit = cd or c_flag
    directory = os.path.expanduser(hit.group(1)) if hit else cwd
    ref = 'HEAD'
    if verb == 'push':
        tail = re.split(r'\bpush\b', command, maxsplit=1)[1]
        positional = [t for t in re.split(r'[\s;&|]+', tail) if t and not t.startswith('-')]
        ref = positional[1].split(':')[-1] if len(positional) > 1 else 'HEAD'
    branch = run(['git', 'branch', '--show-current'], directory) if ref == 'HEAD' else ref
    return directory, branch


def has_open_pr(directory, branch):
    if not branch:
        return False
    out = run(['gh', 'pr', 'list', '--head', branch, '--state', 'open', '--json', 'number', '--limit', '1'], directory)
    return out not in ('', '[]')


def deny(reason):
    json.dump({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'deny', 'permissionDecisionReason': reason}}, sys.stdout)


def main():
    data = json.load(sys.stdin)
    command = HEREDOC.sub('', (data.get('tool_input') or {}).get('command', ''))
    match = GATED.search(command)
    if data.get('tool_name') != 'Bash' or not match or '--dry-run' in command:
        return
    verb = match.group(1)
    path = data.get('transcript_path') or ''
    ask = f"git {verb} needs the user's explicit go-ahead. Ask 'Shall I {verb} <branch>?' and wait for a yes; do not {verb} until they say so."
    human, assistant = (None, '') if not path else last_turns(path)
    if human and NEGATED.search(human):
        return deny(ask)
    directory, branch = target(command, verb, data.get('cwd') or os.getcwd())
    if has_open_pr(directory, branch):
        return
    if '/subagents/' in path or not path:
        return deny(ask + f' Subagents may only {verb} on a branch with an open PR; hand back to the main session.')
    if not human:
        return deny(ask)
    if INTENT[verb].search(human) or (AFFIRM.match(human) and re.search(verb, assistant, re.I)):
        return
    deny(ask)


if __name__ == '__main__':
    main()
