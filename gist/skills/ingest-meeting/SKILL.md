---
name: ingest-meeting
description: Classify a meeting transcript, create brain/artifact outputs with source links, extract knowledge, update the ingest log and changelog.
---

# /ingest-meeting

## Purpose

Process a meeting transcript from `inbox/meetings/` into durable knowledge: meeting summary in `logs/meetings/`, updates to person and project pages, action item tasks, memory events for durable decisions, and hub updates for named entities.

## When to use

- A new transcript landed in `inbox/meetings/`.
- A self-reflection / interview transcript landed (handled specially below).

## Arguments

- `<transcript-path>` (required) — vault-relative path. e.g., `inbox/meetings/2026-05-28-q3-planning.md`.

## Steps

1. **Read and classify.**
   - **Regular meeting** — discussion about work. Two or more participants.
   - **Self-reflection / interview** — the user thinking aloud, structured against a prompt. Handle specially (see below).
   - **Not relevant** — small talk, accidental capture. Archive and exit.

2. **Speaker resolution.** Transcripts often have generic "Speaker 1 / 2 / 3" labels. Resolve to actual attendees by:
   - Cross-referencing the calendar event for that date/time.
   - Looking at the email header (if extracted from a call platform).
   - Asking the user if unclear.

3. **For a regular meeting:**

   **a. Create the meeting summary** at `logs/meetings/YYYY-MM-DD-<slug>.html`:
   - Robin v0.2 HTML.
   - `<meta name="robin:type" content="meeting">`.
   - `<meta name="robin:date" content="YYYY-MM-DD">`.
   - `<meta name="robin:attendee" content="<name>">` repeated for each attendee.
   - `<meta name="robin:duration" content="N min">`.
   - `<meta name="robin:source" content="inbox/meetings/...">`.
   - Body: one-line summary, key points (3–8 bullets), decisions made, action items, follow-ups, link to transcript.

   **b. Extract knowledge:**
   - Update each attendee's page in `brain/people/<bucket>/` with anything new about them.
   - Update the relevant project page in `brain/projects/<slug>/` with status changes, decisions, scope shifts.
   - Create or update decisions in `brain/decisions/YYYY-MM-DD-<slug>.html` when explicit decisions were made.
   - Create or update patterns/standards/playbooks when generalizable rules surfaced.
   - For each, add provenance: `<meta name="robin:source" content="inbox/meetings/...">` and inline citation per [`../lib/provenance.md`](../lib/provenance.md).

   **c. Memory events** for compact durable cues (preferences, corrections, source-of-truth notes) via memory.save.

   **d. Tasks.** For each action item, invoke `/create-task` with:
   - Owner inferred from context (the attendee who committed).
   - Source: `meeting:logs/meetings/YYYY-MM-DD-<slug>.html`.
   - Project: the project discussed.

   **e. Cross-link.** The meeting page links to: each attendee's page, the project page(s) discussed, each decision created, each task created. Each linked entity in turn references the meeting page in its own backlinks (computed at read time).

   **f. Hub update (mandatory).** Any new tool / vendor / framework / org mentioned must go on a hub.

   **g. Archive the transcript.** Move `inbox/meetings/<file>` → `inbox/archived/meetings/<file>`.

4. **For a self-reflection / interview:**

   Self-reflections are *sensitive*. Different rules:

   **a. No meeting page.** Self-reflections don't become public-style summaries.

   **b. Memory extraction preferred.** Extract preferences, decisions, working-style insights as memory events. Tier them `semantic` or `procedural` as appropriate.

   **c. Update `brain/about_user/`** with insights about communication style, values, working hours, blindspots. Be careful — these pages are personal context.

   **d. Update project pages** if the reflection surfaced project insights (cautiously — preserve the reflective tone).

   **e. Compact, not broad.** When a reflection contains sensitive content, prefer compact actionable memory over broad prose. Avoid recording emotional content as durable text unless the user explicitly asks.

   **f. Archive the transcript** as with regular meetings.

5. **Update tracking:**
   - Append to `logs/ingest-log.md`:
     ```
     ## YYYY-MM-DDTHH:MM:SSZ — meeting — <slug>
     source: <inbox-path>
     outputs: logs/meetings/..., brain/decisions/..., brain/tasks/...
     attendees: [name1, name2]
     ```
   - Append to `logs/changelog.md`:
     ```
     ## [YYYY-MM-DD] ingest | meeting [[<slug>]] — <one-line summary>
     ```

6. **Report:**
   ```
   Type: meeting / self-reflection
   Created: <meeting page or memory events>
   Updated: <project pages, person pages>
   Tasks: N
   Memory events: N
   Hubs touched: <list>
   Archived: inbox/archived/meetings/<file>
   ```

## Output shape

Concise. Show the user what was extracted and where it went. They should be able to spot-check by clicking through.

## Edge cases

- **Speaker labels can't be resolved.** Ask the user. Don't invent attribution.
- **Mixed content** (e.g., a meeting that ended in self-reflection). Process the regular-meeting part normally; flag the reflection portion for follow-up.
- **Sensitive content** (HR, personal). Be conservative. Compact actionable memory only, with `sensitivity: private` on any pages or memory events. Surface to user before publishing widely-linked content.
- **The transcript is just a recording, not transcribed.** Halt and tell the user. Don't try to transcribe.
- **A decision is implicit (not stated outright).** Surface as a possible decision in the report; let the user confirm before creating a decision page.
