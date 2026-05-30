---
name: morning-brief
description: Start-of-day briefing. Orchestrates calendar / tasks / Slack / email checks, surfaces ritual blocks, pre-prepares upcoming meetings.
---

# /morning-brief

## Purpose

Compose a concise (<50 lines) briefing covering today's schedule, task health, comms needing attention, and any active ritual blocks. Read-only — never edits the brain or sends messages.

## When to use

- Start of day. Manually invoked.
- After a longer break, when re-orienting.

## Arguments

- `--quick` (optional) — a faster, brain-only version that skips Slack/email checks. Useful when MCPs aren't connected.
- `--for-tomorrow` (optional) — generate the brief for tomorrow instead of today (useful at end-of-day).

## Steps

1. **Read config.** Open `.claude/constitution/config.yaml`. Note which ritual blocks are `true` (`self_reflection`, `weekly_review`, `stakeholder_pulse`, etc.). Note timezone.

2. **Gather in parallel.** Dispatch (or invoke sequentially if your harness can't parallelize):
   - `/check-calendar today` — today's schedule. Writes `.robin/calendar/today.json` snapshot.
   - `/check-tasks` — open task health.
   - `/check-slack` — team and primary channels (if Slack MCP enabled).
   - `/check-email` — inbox triage (if Gmail MCP enabled).
   - If an MCP isn't connected, skip that source silently.

3. **Check last-night's reflection.** If `brain/about_user/reflections/questions.html` was updated yesterday by `/remsleep`, surface the reflection prompt(s) in the brief.

4. **Pre-meeting prep (inline).** For up to **two** upcoming stakeholder/external meetings today:
   - Read the attendees' pages from `brain/people/`.
   - Pull their open tasks (`brain/tasks/` filtered by owner).
   - Pull project background (the project page the meeting is about).
   - Compose a 3–5 line prep block per meeting.

5. **Run ritual blocks** gated `true` in config:
   - **`self_reflection`** — surface a reflection question if it's a reflection day (every N days, per `self_reflection_cadence_days`).
   - **`weekly_review`** — if today is Monday and the flag is true, invoke `/weekly-review` *after* the brief (don't inline it; it's heavy).
   - **`stakeholder_pulse`** — list stakeholders not pinged in N+ days (per `stakeholder_pulse_threshold_days`). Pull from `brain/people/stakeholders/`.
   - Skip blocks whose flag is `false` or absent.

6. **Compose the brief.** Use [`../lib/report-template.md`](../lib/report-template.md). Section order:

   ```markdown
   ## Morning brief — YYYY-MM-DD

   ### Schedule
   (calendar events grouped: stakeholder, team, external, focus)

   ### Tasks
   (P0/P1, overdue, blocked-without-explanation; grouped by priority)

   ### Email
   (needs response / wiki gaps / filtered count)

   ### Slack
   (team activity / needs response / wiki gaps)

   ### Meeting prep
   (inline prep for up to 2 stakeholder/external meetings)

   ### Reflection
   (yesterday's question or new prompt, if applicable)

   ### Rituals
   (weekly review reminder, stakeholder pulse list, etc.)

   ### FYI
   (anything that didn't fit above but the user should see)
   ```

7. **Write to `logs/reports/`.** Save the brief as `logs/reports/YYYY-MM-DD-morning-brief.html` (Robin v0.2 format, `robin:type=brief`, `robin:date=YYYY-MM-DD`).

8. **Emit the summary.** Print the brief to the chat. Keep it scannable — under 50 lines.

## Output shape

- One screen max in most cases.
- Section headings consistent with `lib/report-template.md`.
- No padding. If a section is empty, omit it.

## Edge cases

- **No MCPs connected.** Run brain-only mode. Skip Slack/email sections. Mention which MCPs aren't connected.
- **No tasks.** Show an empty Tasks section saying "No open tasks." Don't pad.
- **It's the weekend.** Calendar will be lighter. That's fine — still produce a brief, just shorter.
- **It's Monday and `weekly_review: true`.** After producing the brief, invoke `/weekly-review` as a separate call.

## Side effects

- Writes `logs/reports/YYYY-MM-DD-morning-brief.html`.
- May write `.robin/calendar/today.json` (via `/check-calendar today`).
- Does NOT edit `brain/`.
- Does NOT send messages.
