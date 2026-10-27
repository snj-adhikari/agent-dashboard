---
name: agent-jira-reply
description: Use whenever the user asks to reply to a Jira comment ("reply to this comment", "reply on the ticket", "reply here <jira link with focusedCommentId>", "reply to the latest comment on ABC-123"). Posts the reply threaded under the target comment, not as a new top-level comment. The Atlassian MCP cannot create threaded replies, so this fills in a blank threaded reply the user has started, or asks them to start one.
---

# Agent: Jira threaded reply

A "reply" on Jira means a threaded reply under a specific comment. A new top-level comment is wrong.

## 1. Find the target

- From a URL: issue key + `focusedCommentId=<id>` is the target comment.
- From words ("reply to the QA comment on ABC-123"): `listJiraIssueComments` and pick the matching comment. If more than one could match, ask which.

## 2. Check whether the MCP can thread now

Run `discover` with "reply to jira comment thread parent". If an operation accepts a parent comment id, use it, then skip to step 5. Otherwise continue (the default: `addOrEditJiraIssueComment` has no parent field).

## 3. Find the user's blank threaded reply

Get the current user's accountId from `atlassianUserInfo`. Then `listJiraIssueComments` on the issue and look for a comment where:

- `parentId` equals the target comment id
- author accountId is the current user's
- body is a placeholder (empty, `.`, `…`, a single character)

## 4. If there is no blank reply

Stop and ask, in one line:

> Can you click Reply on that comment and save a blank `.`? The Jira MCP can't create threaded replies, so I'll fill it in.

Never fall back to a top-level comment unless the user says so in that turn.

## 5. Write the reply

- `addOrEditJiraIssueComment` with `commentId` = the blank reply's id, `contentFormat: "html"`.
- Short bullets, no prose paragraphs, hyperlinks for PRs and tickets, no emojis.
- Always start by tagging the author of the target comment: `<span data-type="mention" data-user-id="<their accountId>">@Name</span>` (accountId from the comment's `author`).
- The request to reply is the go-ahead for this one reply only.

## 6. Confirm

Read the comments back and check the reply's `parentId` is the target and the body is the new content. Report the comment id and the issue key.
