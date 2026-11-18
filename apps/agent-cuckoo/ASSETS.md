# Assets

| Asset | Source | Licence | Where it lives |
| --- | --- | --- | --- |
| App icon and mascot (cuckoo with the ⚑ flag) | Original drawing for agent-cuckoo | Same as this repo | `assets/icon.svg` |
| State emoji: working, waiting, done, thinking, sleeping | [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji), 3D set | MIT | Fetched at build time from the commit pinned in `assets/emoji.lock`, bundled inside the app with upstream's LICENSE file; not stored in this repo |
| Fallback emoji | System emoji font | Provided by the OS | Not bundled |
| UI icons (macOS) | SF Symbols | Apple SF Symbols licence | Provided by the OS |
| UI icons (Windows/Linux) | [Lucide](https://lucide.dev) npm package | ISC | Installed from npm at build time |
| Sounds | Synthesised in code | Same as this repo | No sound files |

`assets/emoji.lock` format: a `commit <sha>` line, then `<name> <path>` lines. The path is relative to the fluentui-emoji repo root and runs to the end of the line (it can contain spaces).
