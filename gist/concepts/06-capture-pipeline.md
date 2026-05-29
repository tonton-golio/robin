# 06 — The capture pipeline

External material enters Robin through `inbox/`. It gets transformed into durable brain pages and, sometimes, polished outputs. This document traces that flow end to end.

## The shape

```
            ┌─────────────────────────────────────────┐
            │                                         │
            ▼                                         │
       ┌────────┐    ingest    ┌────────┐   craft   ┌──────┐
  →    │ inbox/ │  ────────►   │ brain/ │  ──────►  │ out/ │
       └────────┘              └────────┘           └──────┘
                                   │
                                   ▼
                               ┌────────┐
                               │ logs/  │  (append-only audit)
                               └────────┘
```

- **`inbox/`** is the immutable landing zone.
- **`brain/`** is the durable knowledge base.
- **`out/`** is for humans outside the system (slides, plans, polished reports).
- **`logs/`** records every transformation.

## Step 1: capture into `inbox/`

You drop material into `inbox/` in whatever shape it arrived. Don't reshape; don't extract; don't summarize. Just save.

Common landing patterns:

- **Meetings:** transcripts (Markdown) and optional audio (`.webm`, `.mp3`). One file per meeting. Path: `inbox/meetings/YYYY-MM-DD-<slug>.md`.
- **Slack / email exports:** JSONL of relevant threads. Path: `inbox/<source>/YYYY-MM.jsonl`.
- **Shared documents:** PDFs, screenshots, Markdown copies. Path: `inbox/docs/<source>/<filename>`.
- **Annotations:** JSONL of highlights/comments made while reading. Path: `inbox/<tool>/annotations/YYYY-MM.jsonl`.

Conventions:

- **Filenames carry dates** when sources are time-bound (`2026-05-27-team-retro.md`).
- **Subfolders carry source identity** (`inbox/slack/`, `inbox/notion-export/`, `inbox/personal-notes/`).
- **Nothing gets edited after landing.** If you mistakenly capture the wrong file, move it to `inbox/archived/` rather than deleting; preserve the history of what you mistook.

## Step 2: ingest into `brain/`

Two skills handle this:

- **`/ingest-meeting <transcript-path>`** — for meeting transcripts. Knows how to handle speaker labels, action items, decisions.
- **`/ingest-source <path>`** — for everything else (documents, notes, exports, annotations).

What they do (simplified):

1. **Read** the source.
2. **Classify** the material. Is it a meeting? A strategy doc? An annotation? A personal reflection?
3. **Extract durable knowledge:**
   - Decisions → new page in `brain/decisions/YYYY-MM-DD-<slug>.html` or update existing.
   - Action items → tasks in `brain/tasks/<slug>.html` via `/create-task`.
   - Patterns → update or create in `brain/patterns/`.
   - People → update `brain/people/<bucket>/<slug>.html`.
   - Projects → update `brain/projects/<slug>/`.
   - Compact recall cues → append to `brain/memory/events.jsonl` via memory.save.
4. **Write provenance.** Every page touched gets a `robin:source` meta tag (or appends to its existing one) pointing back to the inbox file.
5. **Update hubs.** If the source mentions an entity that belongs on a hub (a tool, vendor, framework), update the hub. Create a new hub if 3+ scattered references now exist.
6. **Log the ingest.** Append to `logs/ingest-log.md` a row mapping source → outputs.
7. **Archive the source.** Move `inbox/meetings/<file>` → `inbox/archived/meetings/<file>`.

The agent does most of this. You watch and correct.

### A worked example

You record a meeting with a stakeholder. The transcription tool drops `inbox/meetings/2026-06-04-q3-planning.md`.

You type `/ingest-meeting inbox/meetings/2026-06-04-q3-planning.md`.

The agent:

- Reads the transcript.
- Resolves speaker labels (Speaker 1 → you, Speaker 2 → the stakeholder; their page gets a wikilink).
- Creates `logs/meetings/2026-06-04-q3-planning.html` — a summary page (key points, decisions, action items, link to transcript).
- Updates `brain/people/stakeholders/<stakeholder-slug>.html` with what they said about Q3 priorities.
- Creates a decision page at `brain/decisions/2026-06-04-q3-priority-shift.html` (because a real decision was made).
- Creates two task pages in `brain/tasks/` for action items you committed to.
- Updates the project page at `brain/projects/<project>/_index.html` because the meeting changed scope.
- Saves a memory event: type `correction`, summary "Q3 priority shifted from X to Y."
- Appends to `logs/ingest-log.md`:
  ```
  ## 2026-06-04 — meeting — q3-planning
  source: inbox/meetings/2026-06-04-q3-planning.md
  outputs: logs/meetings/2026-06-04-q3-planning.html, brain/decisions/2026-06-04-q3-priority-shift.html, brain/tasks/<slug>.html, ...
  ```
- Moves the source to `inbox/archived/meetings/2026-06-04-q3-planning.md`.
- Reports a summary: "Ingested. Created 4 pages, 2 tasks, 1 memory event."

You read the summary, spot-check the new pages, push back on anything misread. Most of the time it's correct.

## Step 3: craft into `out/`

Brain pages are for *you and the agent*. They're terse, well-linked, technical.

When you need to share something with humans outside the system — a board, a customer, a teammate getting onboarded — you compose an artifact in `out/`.

Examples:

- `out/plans/2026-09-roadmap.html` — a polished planning doc for leadership.
- `out/presentations/2026-06-board.html` — a slide deck.
- `out/reports/q2-postmortem.html` — a written report.

These pages:

- Pull material from `brain/` (people, decisions, projects, strategy).
- Add styling, narrative, framing.
- Get reviewed before being shared.
- Carry their own `robin:type` (`brief`, `report`, `plan`) and `robin:state` (`draft`, `final`).

When an artifact is shipped, it becomes a snapshot. The brain keeps evolving; the artifact is the moment-in-time view sent to humans.

## The append-only audit

Every transformation leaves a trail:

- **`logs/changelog.md`** — every `/learn` invocation, every restructure, every promotion. Reverse-chronological. The "what happened" log.
- **`logs/ingest-log.md`** — every `/ingest-*` invocation. Source → outputs mapping. The "where did this come from" log.

These two files together give you full auditability. You can always answer:

- **What changed yesterday?** → grep `[YYYY-MM-DD]` in `changelog.md`.
- **Where did this brain page come from?** → grep the page's slug in `ingest-log.md`.
- **What sources have I ingested this month?** → scan `ingest-log.md` headers.

These logs are **append-only**. Never edit history. If something was logged in error, append a correction row referencing the wrong entry.

## What about things that don't fit?

Sometimes you have material that doesn't cleanly classify. Some patterns:

- **Personal scratch notes.** A free-form text file you want to keep but isn't durable. Land it in `inbox/personal-notes/YYYY-MM/<slug>.md`. The agent will offer to ingest if you ask; otherwise it sits there as raw material.

- **Voice memos / self-reflection.** Treated specially by `/ingest-source` (handler: self-reflection). Insights distribute to `brain/about_user/`, `brain/people/`, `brain/projects/` as appropriate. Often no meeting page is created — the content goes where it belongs.

- **Bookmarks / web clippings.** If they spark durable knowledge, ingest into the relevant brain area. Otherwise sit them in `inbox/clippings/` as a backlog. The friction of having to ingest is intentional — it prevents the brain from filling with low-signal links.

- **Code-related learnings.** If a learning came from working in a repo, the brain page is the right home (`brain/patterns/`, `brain/standards/`, `brain/repos/<repo>.html`). The repo itself keeps its own README; durable conclusions promote to brain.

## Avoiding pipeline anti-patterns

1. **Don't pre-emptively reshape sources.** If you start transforming a source before ingesting, you defeat the audit trail. Capture raw, then ingest.

2. **Don't skip the logs.** Resist the urge to "just edit the brain page directly" without a changelog entry. The log is the only thing that lets you reconstruct your history.

3. **Don't merge inbox and brain.** If a meeting transcript "is fine as-is" you might be tempted to just leave it in `inbox/` and link to it from elsewhere. Don't. Ingest it. Even if the brain page is short, the page is the canonical surface; the inbox file is the immutable source.

4. **Don't let inbox bloat.** Archive after ingest. If you have 200 unprocessed files in `inbox/`, you have a backlog problem. Schedule a clean-up session and treat it as a project.

5. **Don't conflate `out/` and `brain/`.** A board deck in `brain/` muddles the brain. A team retro doc in `out/` is invisible to your agent. Get the placement right.

Continue: [`07-permissions-and-comms.md`](./07-permissions-and-comms.md).
