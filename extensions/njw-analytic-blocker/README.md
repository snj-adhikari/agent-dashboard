# GTA - Blocker

Chrome extension that stops browser automation from polluting analytics, tag manager and ad data on the sites you choose.

## Scope

- Active only in tabs inside a tab group whose title contains "Claude" (the group Claude in Chrome uses). Your own tabs on the same sites are untouched.
- Blocking is applied as session rules scoped to those tab ids, refreshed on every tab or group change. Cookie purging runs only while such a tab exists.
- If blocking never engages, check the group's name in the tab strip and adjust `CLAUDE_GROUP` in `scope.js`.

## Sites

- Sites live in `chrome.storage.sync`, edited on the options page (opens on first install; also Extensions -> Details -> Extension options). Add as many as you like; subdomains are included.
- On first run the list is seeded from `config.json` (`{ "name": "...", "sites": ["example.com"] }`). The Agent Dashboard plugin page writes this file from your settings when it stages or zips the extension.
- Adding a site asks Chrome for host access to it (optional host permissions); grant it so cookie purging and hiding work.

## What it does

- Blocks requests to GA, GTM and Google ad domains (`googletagmanager.com`, `google-analytics.com`, `analytics.google.com`, `doubleclick.net`, `googlesyndication.com`, `googleadservices.com`, `googletagservices.com`, `adservice.google.com`, `adservice.google.com.au`) and Insider (`useinsider.com`, `insiderone.com`) when the initiator is a configured site.
- Blocks third-party `xmlhttprequest`, `ping`, `websocket` and `other` (beacon) requests from those sites. Scripts, images, CSS and fonts still load; `challenges.cloudflare.com` is excluded.
- Strips ad click ids from navigations to those sites (`gclid`, `gclsrc`, `dclid`, `gbraid`, `wbraid`, `gad_source`, `gad_campaignid`, `fbclid`, `msclkid`, `_gl`).
- Deletes tracking cookies on those sites as they are set (`_ga*`, `_gid`, `_gcl_*`, `_fbp`, `_fbc`, `__gads`, `gclid`, Insider prefixes) and once on install/startup.
- Page scripts see an empty `document.cookie` and `cookieStore`; writes are dropped. HttpOnly and server-side cookies still go out with requests, and login cookies are untouched. Site JS that reads cookies (consent, some auth flows) sees none.

## See what was blocked

- Click the toolbar icon: a popup lists every blocked request, newest first, for this tab or all tabs, with counts per kind.
- Kinds: **Analytics event** (GA4 event name such as `page_view`, or the Universal Analytics category / action), **Tag manager** (container id), **Ad request**, **Insider**, **Third-party request**, and **Click ids stripped** (which params were removed).
- GA4 batches several events into one POST body; those show as "events in request body" because Chrome doesn't expose request bodies to the extension.
- The icon badge shows the count for the current tab. **Clear** empties the log; it also resets when Chrome restarts (kept in session storage, last 300).
- Uses `declarativeNetRequest.onRuleMatchedDebug`, which Chrome only fires for unpacked extensions. That's how this one is installed, so nothing extra is needed.

## Install

1. `chrome://extensions` -> Developer mode -> Load unpacked -> this folder (or use "Add to this device" on the Agent Dashboard plugin page).
2. Set your sites on the options page and keep the extension enabled while running Claude in Chrome.

## Check

- `node rules.test.js` validates the rule set, site scoping, cookie matching and how blocked requests are labelled.
- In DevTools Network, blocked requests show as `net::ERR_BLOCKED_BY_CLIENT`.

## Not covered

- First-party or server-side GTM endpoints on a configured site's subdomain.
- Non-Google ad and pixel vendors (add a domain to `rules.json` and a rule id). Insider domains are the vendor's public ones, not confirmed against any particular site.
- Popups opened by page scripts: Chrome's built-in popup blocker applies.
