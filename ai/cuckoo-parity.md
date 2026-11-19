# agent-cuckoo vs coucou: parity

Working doc, not source. Rows follow `ai/factory/coucou-map.md` checklists; status confirmed against code (file paths under `apps/agent-cuckoo/` unless stated; `mac` = `macos/Sources/AgentCuckoo`, `core` = `macos/Sources/CuckooCore`, `tauri` = `tauri/src`). Status: done, partial (what is missing), missing, out of scope, skipped: needs paid key. Screenshot `n/c` = not captured. All art, sounds and copy are original (see `ASSETS.md`).

## 1. Window, placement, island shape

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Non-activating panel above menu bar, all Spaces | done (macOS); Tauri uses its own window | mac/IslandController.swift; tauri/src-tauri/src/island.rs | mac-compact, tauri-compact |
| Click-through outside the island, adaptive hit-test poll | partial (click-through done; no adaptive poll rate) | mac/IslandController.swift | n/c |
| Notch measurement plus no-notch bar fallback | done | core/IslandGeometry.swift | mac-compact |
| Hidden, compact, expanded sizes animating together | done | core/IslandGeometry.swift, core/Motion.swift; tauri/fsm.ts | mac-compact, mac-timer, tauri-compact |
| Corner placement, drag-to-corner | missing | none | n/c |
| Display choice incl. follow mouse | partial (macOS picks a saved display; no follow mouse; Tauri none) | mac/IslandController.swift | n/c |

## 2. State machine, hover, click, Esc, auto-close

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| FSM with timers | done (hidden, compact, expanded; no voice state in Tauri) | core/IslandFSM.swift; tauri/fsm.ts | n/c |
| Hover peek with sound | done | mac/IslandController.swift; tauri/main.ts | n/c |
| Open on hover (opt-in, off by default) | done | core/IslandFSM.swift; mac/Settings.swift | mac-settings |
| Click compact opens | done | mac/IslandController.swift; tauri/main.ts | mac-compact |
| Esc collapse | partial (macOS: only once the panel has focus) | mac/IslandController.swift:9; tauri/main.ts:762 | n/c |
| Close x in header | done | mac/Views/Shell.swift | mac-timer |
| Auto-close and absence-hide, editable | partial (auto-close 10/15/30 s editable; absence-hide fixed) | mac/Views/SettingsCard.swift; core/IslandFSM.swift | mac-settings |
| Held open while approval pending | done | core/IslandFSM.swift; tauri/fsm.ts (pinned) | n/c |
| Countdown bar (last 10 s) | missing (the only countdown is the focus timer) | none | n/c |
| Alerts force-expand, work only reveals | done | mac/IslandController.swift; tauri/main.ts | n/c |
| Global hotkey toggles island | partial (desktop mascot and wardrobe combos only; behind captureShortcuts, off by default) | mac/Views/Shell.swift:82; mac/HotKeys.swift | n/c |

## 3. Dock and menu bar presence

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Dock icon with toggle | done (off by default) | mac/main.swift; mac/Settings.swift (showDockIcon) | mac-settings |
| Dock click opens island | done | mac/main.swift:37 | n/c |
| Dock right-click menu | missing | none | n/c |
| Menu bar icon with menu (Open, Settings, About, Quit) | done (macOS); Tauri has no tray | mac/main.swift:19-29 | n/c |
| Menu bar icon recolours on pending state | missing | none | n/c |
| Launch at login | missing | none | n/c |

## 4. Collapsed island

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Mascot left, session mini grid right | partial (mascot plus one pill per CLI, not per session) | mac/Views/Compact.swift; tauri/main.ts | mac-compact, tauri-compact |
| Mini mascot per session with state badge | partial (state badge on the pill; pill is per CLI) | mac/Views/Badges.swift | mac-compact |
| Eyes follow cursor | missing (pose art, not a rig; blink only) | mac/Views/Mascot.swift | n/c |
| Vitals hover line | missing | none | n/c |

## 5. Expanded shell

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Header tabs and gear, speaker, x | done (tab set differs: home, chat, main agents, launch, drop, more, plus extras) | mac/Views/Shell.swift; tauri/main.ts | mac-wardrobe, tauri-launcher |
| Card background with state wash | done | mac/Views/Shell.swift; tauri/style.css | mac-services |
| Mascot on card left, resized per view | done | mac/Views/Mascot.swift; tauri/views/mascot.ts | mac-music, mac-whats-new |
| Column of mini mascots on non-overview views | missing | none | n/c |
| Pill buttons primary/secondary | done | mac/Views/Cards.swift; tauri/views/cards.ts | mac-timer |

## 6. Overview and session pills

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Left card: name, source, step counter, ticker, jump arrow | partial (ticker and jump done; no step counter) | mac/Views/Overview.swift; tauri/views/overview.ts | mac-overview, tauri-overview |
| Ticker with 3-row roll and shimmer | partial (shimmer done; no 3-row roll) | tauri/views/overview.ts; tauri/style.css | tauri-overview |
| Diff steps and diff card | missing | none | n/c |
| Multi-session pill lines, hold, pop-out | partial (sessions list view; no hold or `#2` pop-out) | mac/Views/Sessions.swift; tauri/views/sessions.ts | mac-sessions, tauri-sessions |
| Pill grid, hover glow | partial (pills present; no glow) | mac/Views/Overview.swift | mac-overview |
| "+N waiting" stack | done | mac/Views/Compact.swift; tauri/board.ts | mac-overview |
| Per-pill alert badge | done | mac/Views/Badges.swift; tauri/views/mascot.ts | mac-overview |
| Keyboard pill cycling | missing | none | n/c |

## 7. Approvals and questions

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Approval card: Deny / Allow / Always, queue counter | done (Always hidden where the host cannot grant) | mac/Views/Cards.swift:139; tauri/views/cards.ts | n/c (needs live approval) |
| Plan-approval variant | partial (plan decisions mapped in Cards.swift:145; no ExitPlanMode detection in the relay) | mac/Views/Cards.swift | n/c |
| Decision bound to request id, stale click ignored | done (409 `stale`, request id plus screen hash) | src/routes/cuckooActions.ts:67,75; tauri/api.ts | n/c |
| Question card (single, multi, Other) | partial (question card for main and sub-agent asks; no multi-select, no 4-question flow) | mac/Views/Cards.swift; tauri/views/cards.ts | n/c |
| Error card with open terminal | done | mac/Views/Cards.swift | n/c |
| Finished card (5.2 s) | done | core/Reaction.swift; mac/Views/Cards.swift | n/c |
| FIFO queues (max 5), "1/N" | done | core/ApprovalQueue.swift | n/c |
| Agent-answered-elsewhere drop | partial (card drops when the board no longer shows the prompt; no socket hang-up check) | src/routes/cuckooActions.ts | n/c |

## 8. Jump to terminal

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Open terminal from arrow, finished card, hotkey | partial (arrow and cards; no hotkey) | mac/Views/Overview.swift; src/services/cuckoo/focus.ts | mac-overview |
| Bundle-id then known-terminal fallback | done (host-specific focus instead: cmux, Herdr app, herdr, tmux) | src/services/cuckoo/focus.ts | n/c |

## 9. Chat panel

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Chat view: mascot, history, input | done | mac/Views/Chat.swift; tauri/views/chat.ts | mac-chat-greeting, tauri-chat |
| Bubbles, markdown, streaming cursor | partial (bubbles and streaming; markdown not rendered) | mac/Views/Chat.swift; tauri/views/chat.ts | n/c (no reply captured) |
| Typing dots | done | mac/Views/Chat.swift | n/c |
| Provider and model chip | partial (CLI chip with picker; no model list) | mac/Views/Chat.swift | mac-chat-greeting |
| Subscription-CLI mode, sandboxed | partial (claude only; stdin, no credential reads; other CLIs show badge only) | src/services/cuckoo/chat.ts; clis.ts | tauri-chat |
| Context chip from drop or capture | done | mac/Views/Drop.swift; tauri/views/drop.ts | tauri-drop |
| Mascot reactions while chatting | partial (thinking, happy, error; no proud or surprised) | core/Reaction.swift | n/c |
| Searching view | missing | none | n/c |
| Chat hotkey and send shortcuts | missing | none | n/c |
| Greeting bubble | done (new design: time-of-day greeting) | core/Greeting.swift; tauri/greeting.ts | mac-chat-greeting |

## 10. Settings

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| In-island settings card | done | mac/Views/SettingsCard.swift; tauri/views/settings.ts | mac-settings, mac-settings-scrolled |
| Full settings window with search | missing (single in-island card) | none | n/c |
| Sound box (toggle, volume) | partial (toggle and volume; no custom folder or reload) | mac/Views/SettingsCard.swift | mac-settings |
| Behaviour box | partial (open on hover, auto-close; no alerts-from-all, no absence-hide) | mac/Views/SettingsCard.swift | mac-settings |
| Display box | missing | none | n/c |
| Vitals toggle | missing | none | n/c |
| Hotkey and startup toggles | partial (capture shortcuts toggle; no startup) | mac/Settings.swift | mac-settings-scrolled |
| Active pills and main pill | done (every CLI and every space main listed) | mac/Views/MainAgents.swift | tauri-main-agents |
| Agent hook install boxes | out of scope (§19 installers; cuckoo reads the monitor) | none | n/a |
| Plan usage box | partial (read-only usage chip; no install or toggle) | mac/Views/Badges.swift | mac-more-menu (local only) |
| Chat settings (keys, local models) | missing (no keys by design) | none | n/a |
| Shortcuts editor | missing | none | n/c |
| Language (16) | done (15 locales plus English, picker in settings) | i18n/*.json; mac/Views/SettingsCard.swift | mac-settings |

## 11. Plan-usage pill

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Header plan pill, colour thresholds | done | mac/Views/Badges.swift; core/UsageColour.swift; tauri/usage.ts | mac-more-menu (local only), tauri-overview (local only) |
| Plan card with 5 h and weekly gauges | partial (values in tooltip; no card) | mac/Views/Badges.swift:51 | n/c |
| Mascot tint follows usage | missing | none | n/c |

## 12. Sounds

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Sound engine, default volume, mute | done | mac/Sounds.swift; tauri/sounds.ts | mac-settings |
| Trigger table | partial (peek, open, close, approval, question, finish, error, send, pop, tick, gulp, blip, poke, timer; others missing) | mac/Sounds.swift; assets/sounds/ | n/a |
| Skip finish/error when terminal frontmost | missing | none | n/a |
| Custom sounds folder | missing | none | n/a |

## 13. Mascot behaviours

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Bot states | partial (original cuckoo poses mapped from working, waiting, done, unknown, sleeping, celebrating; fewer than coucou's 11) | core/StateEmoji.swift; core/Reaction.swift | mac-compact, tauri-compact |
| Eye tracking | missing | none | n/c |
| Random blink | done | mac/Views/Mascot.swift; tauri/views/mascot.ts | n/c |
| Hover reaction, love emote | missing | none | n/c |
| Poke with 3-hit dizzy | partial (desktop mascot only) | mac/DesktopMascot.swift; core/DesktopMascotLogic.swift; tauri/desktopMascotLogic.ts | mac-desktop-mascot |
| Happy jump on finish | done (celebrating, 5.2 s) | core/Reaction.swift | n/c |
| Sleep state | done (sleeping after 120 s done; yawn missing) | core/Reaction.swift | tauri-timer |
| Surprised, proud, wink, annoyed, listening emotes | partial (listening view only) | mac/Views/Listening.swift | n/c |
| Launch greeting animation | partial (text greeting; no 4.6 s canvas animation) | core/Greeting.swift; tauri/greeting.ts | mac-chat-greeting |
| Outfits plus seasonal Auto | done (12 outfits, hemisphere switch) | core/Outfit.swift; mac/Views/Wardrobe.swift; tauri/views/wardrobe.ts | mac-wardrobe, tauri-wardrobe |
| Desktop mascot | done (macOS and Tauri window) | mac/DesktopMascot.swift; tauri/desktopMascot.ts | mac-desktop-mascot |
| Pop out of the clock on new approval | missing | none | n/c |

## 14. Animation parameters

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Open spring and close curve | done (own values: spring 0.5/0.72, close 0.34 s) | core/Motion.swift | n/a |
| Shared-element motion | done (macOS); Tauri CSS transitions | core/Motion.swift; tauri/motion.ts | n/a |
| Staggered mini motion (35 ms) | partial (value defined; no column view to stagger) | core/Motion.swift | n/a |
| Eased state transitions (0.4 s) | done | core/Motion.swift | n/a |
| Reduce Motion | done (new: 200 ms cross-fade, no spring, no stagger, frozen bob) | core/Motion.swift; tauri/motion.ts | n/a |

## 15. Onboarding and first run

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Launch greeting once per start | partial (greeting text in chat; no launch animation) | core/Greeting.swift | mac-chat-greeting |
| Empty state with Ask button | partial (empty state; no Ask button) | mac/Views/Overview.swift | n/c |
| Whats-new after update | done | mac/Views/WhatsNew.swift; tauri/views/whats-new.ts; assets/whats-new.json | mac-whats-new |
| Update-available card | out of scope (coucou update card) | none | n/a |
| First-run hook install flow | out of scope (§19 installers) | none | n/a |

## 16. Session launcher

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Launch tab (project, prompt, CLI) | done (installed CLIs only) | mac/Views/Launcher.swift; tauri (launcher view in main.ts) | mac-launcher (local only), tauri-launcher |
| File drop onto a session | partial (drop view with upload and capture; not onto a specific session) | mac/Views/Drop.swift; tauri/views/drop.ts; src/services/cuckoo/side/upload.ts | tauri-drop |

## 17. Keyboard shortcuts

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Global open-chat, go-to-alert, jump, cycle, mute | missing | none | n/c |
| Local shortcuts in the island | partial (Esc only) | mac/IslandController.swift; tauri/main.ts | n/c |
| Capture, desktop mascot, wardrobe global combos | done, off by default (coucou has none of these; note below) | mac/HotKeys.swift; mac/Capture.swift; tauri/src-tauri/src/side.rs | mac-settings-scrolled |

## 18. Side features (in scope per SNJ)

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Mail triage | done (opt-in via Settings; local Mail read) | src/services/cuckoo/side/mail.ts; mac/Views/Mail.swift; tauri/views/mail.ts | mac-mail |
| WhatsApp | partial (unread count and compose only; no public API to read chats) | side/whatsapp.ts; mac/Views/Messages.swift | mac-messages |
| Crypto portfolio | done (CoinGecko keyless; holdings added in Settings) | side/crypto.ts; mac/Views/Portfolio.swift; tauri/views/portfolio.ts | mac-portfolio |
| Apple Music and Spotify pills, dance | done (now playing; dance pose) | side/music.ts; mac/Views/Music.swift; tauri/views/music.ts | mac-music |
| Voice "OK Cuckoo" wake word | done (macOS only, on-device, opt-in) | mac/Voice.swift; mac/Views/Listening.swift | n/c |
| Dictation and Notetaker | done (macOS only, on-device) | mac/Dictation.swift; mac/Notetaker.swift; side/notes.ts; mac/Views/Notes.swift | mac-notes |
| iPhone and Android phone link | partial (phone link service endpoint; native iPhone app and Live Activity: skipped: needs paid key, Apple Developer Program) | side/phone.ts | n/a |
| Native iPhone app, Live Activity | skipped: needs paid key | none | n/a |
| Service integrations: GitHub | done (reuses `gh` login) | side/services.ts; mac/Views/Services.swift | mac-services |
| Service integrations: Stripe, Vercel, n8n | partial (via installed CLIs; Vercel and n8n flags from docs, not verified) | side/services.ts:21-28 | mac-services |
| Service integrations: Notion, Cal.com, Resend | partial (via signed-in claude.ai connectors; tool names unverified, shows needs_key here) | side/services.ts:31-37 | mac-services |
| Screenshots to Claude | done (capture, macOS `screencapture`) | mac/Capture.swift; side/upload.ts | tauri-drop |
| Weekly recap | partial (counts; finishes and errors are 0, no source) | side/recap.ts; mac/Views/Recap.swift; tauri/views/recap.ts | mac-recap, tauri-recap (local only) |
| Focus timer | done | core/CuckooTimer.swift; tauri/timer.ts | mac-timer, tauri-timer |
| 16 UI languages | done (15 locales plus English, machine-drafted) | i18n/*.json | mac-settings |

## 19. Agent integration and data flow

| coucou feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Local hook socket server | out of scope (cuckoo reads the monitor over HTTP with a token) | src/routes/cuckoo.ts; src/services/cuckoo/token.ts | n/a |
| Relay adding agent, terminal and title context | out of scope (monitor relay) | src/services/cuckoo/relayLog.ts | n/a |
| Routing rules (agent tag, host) | done (host: herdr, Herdr app, cmux, tmux, bare) | src/services/cuckoo/agents.ts | tauri-sessions (local only) |
| Event-to-state mapping | done | core/Board.swift; tauri/board.ts | n/a |
| Held approvals with time-outs | partial (polled screen prompts; no held connection) | src/routes/cuckooActions.ts | n/a |
| Safe hook installers | out of scope | none | n/a |
| Plan-usage feed | done (via monitor usage service) | src/services/cuckoo/usage.ts | n/a |

## Extras (beyond coucou)

| feature | agent-cuckoo status | where (file) | screenshot |
|---|---|---|---|
| Main-agent management (list per space, send, replies, sub-agent asks, approvals) | done (asks and approvals need live state to show) | mac/Views/MainAgents.swift; tauri/views/main-agents.ts; src/routes/cuckooActions.ts | tauri-main-agents (local only) |
| All-sessions view | done | mac/Views/Sessions.swift; tauri/views/sessions.ts | mac-sessions, tauri-sessions (local only) |
| Host badges, grouped by host then space, MAIN badge, jump-to | done | tauri/views/sessions.ts:10-25; src/services/cuckoo/focus.ts | tauri-sessions (local only) |
| Per-CLI badges and sign-in detection | done | src/services/cuckoo/clis.ts; mac/Views/Badges.swift | mac-launcher (local only) |
| Chat through local CLI | partial (claude only) | src/services/cuckoo/chat.ts | tauri-chat |
| Reduce Motion | done | core/Motion.swift; tauri/motion.ts | n/a |
| Time-of-day greeting | done (5/12/17/21 boundaries; "Up late?" at night; "Hello!" fallback) | core/Greeting.swift; tauri/greeting.ts | mac-chat-greeting, tauri-chat |

## Known differences and risks

- Capture and global shortcuts are off by default (`captureShortcuts`); coucou binds Cmd-Shift-S globally, which breaks Save As.
- Esc closes the macOS island only after the panel has focus (non-activating panel).
- Translations in 15 locales are machine-drafted, not native-reviewed.
- Vercel and n8n CLI flags are from docs, not verified (not installed). Notion, Cal.com and Resend connector and tool names are unverified (show needs_key here).
- Native iPhone app and Live Activity: skipped: needs paid key (Apple Developer Program). WhatsApp chat reading has no public API (count and compose only). Crypto uses CoinGecko keyless.
- Relay trust residual risk: trust lines are fresh-only (2 minutes) and consumed once per Claude session; a sibling pane sharing an unclaimed cmux workspace or tmux session key could replay a fresh identical line once within that window. Full fix: shared consumed record next to the relay log.
- Tauri bundle id changed to `dev.nightwalker.agent-cuckoo.tauri`; Tauri settings from be88741 do not carry over.
- Recap finishes and errors counts are 0 (no source). Approvals are inferred from relay hashes.
- Not captured (need live agent state): approval, question, finished, error, chat reply, main agents with asks, sub-agent ask. Before shots (be88741) not captured.
- Tauri wardrobe and timer cards clip content at the shot size (tauri-wardrobe, tauri-timer); tracked as a layout follow-up.
- Screenshots with live board data (agent names, session titles, project names) stay local only.
  - Committed (no live board data): mac-compact, mac-wardrobe, mac-settings, mac-settings-scrolled, mac-timer, mac-mail, mac-messages, mac-services, mac-music, mac-notes, mac-whats-new, mac-chat-greeting, mac-desktop-mascot, mac-portfolio, tauri-compact, tauri-wardrobe, tauri-timer, tauri-drop, tauri-chat, tauri-launcher, tauri-more-menu.
  - Local only: mac-more-menu (shows agent names eon, fermi and session titles; moved off the committed list after review), mac-expanded, mac-launcher, mac-overview, mac-recap, mac-sessions, tauri-main-agents, tauri-overview, tauri-recap, tauri-sessions.
