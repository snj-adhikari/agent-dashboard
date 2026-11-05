# Agent - Nepali voice

Plugin id: `nepali-voice`.

Speak or type Nepali or Roman Nepali. `/ne` records from the microphone and transcribes locally; Claude acts on the English meaning and replies in English, starting with `Understood as: <English>`. Your original text stays in context. Learns phrases into a glossary. This plugin sends nothing anywhere.

## Install

- Marketplace: `claude plugin install nepali-voice@agent-monitor`
- Local: `claude --plugin-dir ./mods/nepali-voice`

Speech-to-text tools (only needed for `/ne`):

```sh
brew install sox whisper-cpp
mkdir -p ~/.cache/nepali-voice/models
curl -L -o ~/.cache/nepali-voice/models/ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

Uninstall: `brew uninstall sox whisper-cpp && rm -rf ~/.cache/nepali-voice`

## Folder

Same folder as `agent-more-like-you`, resolved once, first hit wins:

1. `MORE_LIKE_YOU_VAULT`: the folder itself.
2. `VAULT_PATH`: `<root>/more-like-you`.
3. Dashboard `settings.vaultPath` from `${AGENT_MONITOR_URL}/api/settings` (default `http://127.0.0.1:5818`). Best effort; errors fall through.
4. `~/.claude/more-like-you`.

It reads `nepali-voice.json`, and reads and appends `nepali-glossary.md` and `raw/<date>-nepali-learnt.jsonl`. Missing or malformed files use defaults; nothing crashes.

On `session.start` it writes `languages/ne-roman.json` once when missing. It is the Roman Nepali detector that `agent-more-like-you` uses for its language gate. Edit it freely; it is never overwritten.

## nepali-voice.json

Optional, this plugin's own settings. Missing keys use the default. Voice settings are not read from `languages.json`, which is shared language knowledge owned by `agent-more-like-you`.

```json
{
  "voiceConfirm": "auto",
  "sttCommand": ["whisper-cli", "-l", "ne", "-m", "{model}", "-ojf", "-f", "{wav}"],
  "model": "~/.cache/nepali-voice/models/ggml-large-v3-turbo-q5_0.bin",
  "threshold": 0.6
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `voiceConfirm` | `auto` | `never` submits the transcript; `always` fills the prompt box so you edit first; `auto` fills only when confidence is below `threshold` or the transcript is empty or very short |
| `sttCommand` | as above | command run for transcription; `{model}` and `{wav}` are substituted |
| `model` | as above | whisper.cpp model file |
| `threshold` | `0.6` | confidence below which `auto` asks you to confirm |

## Hooks and commands

| Event | What it does |
| --- | --- |
| `session.start` | Registers `/ne`. Folds any staged learnt rows into `nepali-glossary.md`, best effort. |
| `/ne` | Records (silence stops it, 60 s cap), transcribes, then submits or fills per `voiceConfirm`. A silent recording gives a microphone-permission message; STT failure or timeout gives an error. Nothing is submitted in either case. |
| `/ne fix <phrase> = <meaning>` | Stages a manual glossary row. |
| `prompt.submit` | For your typed prompts and `/ne` submits (not slash commands): Devanagari, or Roman Nepali with at least two hits including one unambiguous word, adds translate context. The prompt text is never changed. |
| `turn.complete` | Takes the meaning from the `Understood as:` line (subagent turns skipped) and learns it when your next prompt is not a correction. |
| `session.end` | Drops any pending, unconfirmed phrase. |
