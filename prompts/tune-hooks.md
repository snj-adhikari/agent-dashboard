Help me tune the agent-monitor automation hooks (README "Hooks" section).

1. Read the current state: `curl http://localhost:5818/api/hook-status` and summarise each hook's enabled flag, poll interval, last poll, last error and queue length.
2. Ask how quickly I want new Jira assignments, Slack PR-review requests and Jira @mentions picked up.
3. Each poll runs `claude -p` and costs money. Estimate polls per day for the intervals I choose (1440 / minutes per hook) and tell me before applying anything below 15 minutes.
4. Apply the intervals I approve:
   `curl -X POST -H 'Content-Type: application/json' -d '{"minutes":30}' http://localhost:5818/api/hooks/<hook>/interval`
   (whole minutes, 5 to 1440). The Hooks page has the same picker.
5. If usage gates or the Jira project list need changing, show me where on the Setup page; don't edit settings directly.
6. Confirm with another `hook-status` call that the new intervals show.
