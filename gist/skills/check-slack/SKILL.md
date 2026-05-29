---
name: check-slack
description: Scan Slack for what needs attention. Team standup digest, mentions, DMs, wiki gaps.
---

# /check-slack

## Purpose

Monitor configured Slack channels and DMs. Surface messages needing response, important updates, and wiki-worthy knowledge.

Requires a Slack MCP integration.

## When to use

- As a sub-skill called by `/morning-brief`.
- Manually mid-day for a re-check.

## Configuration (from `config.yaml`)

- `slack_user_id` — your Slack user ID.
- `team_standup_channel` — the channel for end-of-day standups (always scanned).
- `primary_channels` — list of channel IDs to scan beyond the standup channel.
- `team_members` — list of team-member names for DM scanning.

## Steps

1. **Team standup digest.** Read `team_standup_channel` for the last 24 hours.
   - Group messages by author.
   - For each teammate: extract what landed, what's in flight, what's planned.
   - Surface anything needing the user: blockers, awaiting-review items, decisions requested.
   - Flag wiki-worthy items (named tools, new vendors, decisions, learnings).

2. **Primary channels.** For each channel in `primary_channels`:
   - Read the last 24 hours.
   - Classify each message:
     - **Needs response** — mention of the user, direct question, assignment.
     - **FYI important** — decisions, status changes affecting active work.
     - **FYI low priority** — chatter, bot messages, indirect mentions.
     - **Wiki-worthy** — content that should be captured (new vendor, new pattern, decision).

3. **DMs.** For each name in `team_members`:
   - Look up their Slack user ID.
   - Read DM channel with the user for last 24 hours.
   - Classify as above.

4. **Filter noise.** Bot messages, automation, "joined the channel" — count them, don't list.

5. **Compose the report** using [`../lib/report-template.md`](../lib/report-template.md):

   ```markdown
   ### Slack

   **Team standup** (yesterday)
   - [[alex-park]]: shipped X; in flight Y; planned Z.
   - [[jamie-doe]]: blocked on credentials for the migration.

   **Needs response** (N)
   - [#channel] [[stakeholder-name]] asked about Q3 capacity.
   - [DM with [[jamie-doe]]] wants a 1:1 next week.

   **FYI important**
   - [#channel] [[other-team]] is launching the new dashboard Friday.

   **Wiki gaps** (N)
   - New vendor mentioned in #ops: "Acme CDN" — no brain page yet.

   **Filtered** 30 noise items (bots, automation).
   ```

## Output shape

15–30 lines typical. Longer if the day has unusual Slack activity.

## Edge cases

- **Slack MCP not connected.** Skip silently.
- **A channel ID is invalid.** Note in the report; skip that channel.
- **Standup channel is silent.** Note "no standup activity" and move on.
- **Bot messages with valuable content** (e.g., deploy notifications with errors). Classify as FYI important, not noise.

## Side effects

- None. Read-only.
- Does NOT post anything to Slack. (Posting is `/eod-signoff`'s domain.)
