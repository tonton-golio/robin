---
name: check-email
description: Filter email noise, surface human emails needing response, flag wiki gaps.
---

# /check-email

## Purpose

Triage the email inbox. Filter newsletters, calendar invites, bot mail. Surface what actually needs the user's attention.

Requires an Email MCP integration (e.g., Gmail).

## When to use

- As a sub-skill called by `/morning-brief`.
- Manually for an inbox sweep.

## Configuration (from `config.yaml`)

- `email` — the user's email address.
- `noise_senders` — list of senders / domains to silently skip.

## Arguments

- `unread` (default) — unread emails.
- `today` — emails received today (read or unread).
- `since:YYYY-MM-DD` — emails since a date.

## Steps

1. **Read inbox** via the Email MCP. Use the most efficient query for the argument:
   - `unread` → `is:unread in:inbox`.
   - `today` → `newer_than:1d in:inbox`.
   - `since:YYYY-MM-DD` → `after:YYYY/MM/DD in:inbox`.

2. **Filter noise.** For each thread:
   - Match `From:` against `noise_senders`. If match, skip and increment noise count.
   - Common noise senders to add over time: GitHub notifications, calendar invites from booking tools, marketing newsletters, monitoring alerts (unless escalating), expense receipts.

3. **Classify remaining (human) messages:**
   - **Match against stakeholders.** Check if sender is in `brain/people/stakeholders/`. If yes, mark stakeholder + wikilink.
   - **Needs response** — direct question, explicit request for action, awaiting reply.
   - **Wiki gap** — content suggesting brain knowledge is missing.
   - **Actionable notification** — doc shared for review, approval requested, deadline communicated.
   - **FYI** — informational, no action required.

4. **Compose the report** using [`../lib/report-template.md`](../lib/report-template.md):

   ```markdown
   ### Email

   **Needs response** (N)
   - [[stakeholder-name]] — Q3 capacity check, needs answer by Thursday.
   - [Sam@vendor] — proposal feedback request.

   **Wiki gaps** (N)
   - New tool mentioned by [[alex-park]] — "Acme Vault" — no brain page yet.

   **Actionable**
   - [Legal] DPA pending review (link).

   **Filtered** 14 noise items (newsletters, calendar invites, bots).
   ```

## Output shape

10–20 lines typical.

## Edge cases

- **Email MCP not connected.** Skip silently.
- **A stakeholder isn't in `brain/people/stakeholders/`.** Flag as wiki gap — they should be added.
- **Promotional email pretending to be personal.** If a "Hi {USER}!" template makes it through filtering, you can add the sender's domain to `noise_senders`. Suggest the addition in the report.
- **Multi-recipient threads.** Look at the "From:" of the most recent message and the user's role in the thread (CC, To).

## Side effects

- None. Read-only.
- Does NOT send any messages. (Sending is `/eod-signoff` or explicit "send" requests.)
