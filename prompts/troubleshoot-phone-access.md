My phone can't use agent-monitor over Tailscale (or doesn't get notifications). Diagnose it step by step and tell me the cause before changing anything.

1. Server: `curl http://localhost:5818/api/mobile/pulse` returns `"ok":true`. If not, agent-monitor isn't running.
2. Tailscale on the Mac: `tailscale status` shows this Mac connected and the phone listed on the same account. Note whether the phone shows as active or idle.
3. Reachability: `tailscale ping <phone name>` succeeds.
4. Serve: `tailscale serve status` proxies `/` to `http://127.0.0.1:5818`. If it's missing, offer to run `tailscale serve --bg http://127.0.0.1:5818`.
5. HTTPS from the Mac: `curl https://<mac>.<tailnet>.ts.net/api/mobile/pulse`.
   - `403`: the request isn't from the Mac owner's Tailscale login, or used an IP instead of the MagicDNS name.
   - Timeout on the first try: certificate being issued; retry.
6. Phone-side causes to ask me about:
   - The page says "site can't be reached": Tailscale off on the phone, or Android Private DNS / Chrome secure DNS bypassing Tailscale DNS. Turn on "Use Tailscale DNS" in the phone's Tailscale app; set Private DNS to Off or Automatic.
   - The page loads but says "Mac unreachable": the Mac is asleep or agent-monitor stopped.
7. Notifications:
   - Test button sends nothing: count subscriptions in `push-state.json` (don't print keys); if zero, re-tap Enable notifications on the phone.
   - Test works but sessions never notify: check the `agent-monitor-hook` mod is installed and the session was started after installing it.
   - iPhone: it must be opened from the Home Screen icon, iOS 16.4 or later.

Report what you found as short bullets with the fix. Don't change SSH, firewall or macOS sharing settings.
