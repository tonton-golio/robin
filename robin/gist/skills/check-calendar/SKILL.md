---
name: check-calendar
description: Scan calendar events, classify them, surface prep needs.
---

# /check-calendar

## Purpose

Read the calendar for a time range (default: today). Classify events. Surface prep needs for stakeholder / external meetings.

Requires a Calendar MCP integration (e.g., Google Calendar).

## When to use

- As a sub-skill called by `/morning-brief`.
- Manually when looking ahead at the week.

## Arguments

- `today` (default) — events from now until end of today.
- `tomorrow`
- `week`
- `<YYYY-MM-DD>` — specific date.

## Steps

1. **Read calendar** via your Calendar MCP for the requested range.

2. **Classify events:**
   - **Stakeholder meeting** — attendees include someone in `brain/people/stakeholders/`.
   - **Team sync** — attendees include teammates from `brain/people/team/`.
   - **External** — attendees are external to the org.
   - **Focus** — solo event blocked for focus work.
   - **Other** — uncategorized.

3. **Surface prep needs:**
   - For stakeholder/external meetings: look up attendee pages in `brain/people/`. Note any open tasks for those attendees. Note recent meeting history.
   - For team syncs: lighter prep — quick refresh on what each teammate is working on.
   - Mark events without context as "needs prep" if they're with external folks.

4. **Write the snapshot** (today range only):
   - File: `.robin/calendar/today.json`.
   - Structure:
     ```json
     {
       "date": "2026-05-28",
       "timezone": "{{TIMEZONE}}",
       "generatedAt": "2026-05-28T08:30:00Z",
       "events": [
         {
           "id": "google-event-id",
           "start": "2026-05-28T09:00:00Z",
           "end": "2026-05-28T09:30:00Z",
           "title": "1:1 with Jamie",
           "classification": "team",
           "attendees": ["jamie@example.com"],
           "linked_people": ["jamie-doe"],
           "prep_needed": false
         }
       ]
     }
     ```
   - This file is consumed by morning-brief and any UI you have.

5. **Compose the report** using [`../lib/report-template.md`](../lib/report-template.md):

   ```markdown
   ### Calendar

   **Today** (N events)
   - 09:00 — 1:1 with [[jamie-doe]] (30m, team)
   - 11:00 — Q3 planning with [[stakeholder-name]] (60m, stakeholder) [prep needed]
   - 14:00 — Focus block (2h)

   **Prep needed**
   - 11:00 Q3 planning — see [[stakeholder-name]] page; 2 open tasks.

   **Heavy day**
   - 5 hours in meetings; protect the 14:00 focus block.
   ```

## Output shape

10–20 lines for a typical day. Longer if the day is unusually busy.

## Edge cases

- **Calendar MCP not connected.** Skip silently; report nothing.
- **Cancelled / declined events.** Filter out.
- **All-day events.** Surface at the top, not interleaved with time-bound events.
- **Recurring 1:1.** Treat as team unless the attendee is a stakeholder.

## Side effects

- Writes `.robin/calendar/today.json` (today range only).
- Does NOT edit `brain/`.
