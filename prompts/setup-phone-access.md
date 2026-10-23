Set up phone access to Agent Dashboard over Tailscale, following the README "Mobile (phone over Tailscale)" section. Agent Dashboard should already be running on port 5818.

1. Check Tailscale on this Mac: `tailscale status` (with the Mac App Store build the CLI is `/Applications/Tailscale.app/Contents/MacOS/Tailscale`). If it isn't installed or signed in, send me to https://tailscale.com/download and wait.
2. Confirm my phone shows up in `tailscale status` on the same account. If not, tell me to install Tailscale on the phone and sign in with that account.
3. Publish the dashboard to my tailnet only: `tailscale serve --bg http://127.0.0.1:5818`. If it prints a login.tailscale.com link, Serve is off for the tailnet: give me the link, wait for me to approve, then run it again. Never use `tailscale funnel`; that would put the dashboard on the public internet.
4. Verify from this Mac: `tailscale serve status` shows the proxy, and `curl https://<mac>.<tailnet>.ts.net/api/mobile/pulse` returns `"ok":true`. The first request can time out while the certificate is issued; retry once.
5. Give me the phone URL `https://<mac>.<tailnet>.ts.net/m/` and these steps:
   - Android: open it in Chrome, tap Install app (or Chrome menu, Add to home screen, Install).
   - iPhone: open it in Safari, Share, Add to Home Screen.
   - Open the installed app, tap Enable notifications, then Test.
6. For automatic "waiting for you" notifications, check the `agent-monitor-hook` mod is installed in Claude Code; if not, show me how from the README "Mods and extensions" section.
7. After I tap Test, check `push-state.json` has a subscription (count only; don't print keys).

Don't change macOS sharing, SSH or firewall settings. Phone access doesn't need SSH.
