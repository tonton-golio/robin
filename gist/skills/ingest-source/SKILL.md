---
name: ingest-source
description: Process any source file (not meetings) from inbox/ into brain pages, artifacts, or both. Classifies, extracts knowledge, preserves provenance, updates tracking logs.
---

# /ingest-source

## Purpose

Take an immutable source from `inbox/` and turn it into durable knowledge in `brain/` (and optionally polished outputs in `out/`), with full provenance and tracking.

## When to use

- A document, exported chat, screenshot, or notes file landed in `inbox/`.
- A batch of browser annotations landed in `inbox/<tool>/annotations/`.
- Personal scratch notes worth promoting.

**Not for meetings** — use `/ingest-meeting` instead.

## Arguments

- `<source-path>` (required) — vault-relative path to the source file. e.g., `inbox/docs/board-deck-may.pdf`.
- `annotations` (optional sub-mode) — if invoked as `/ingest-source annotations`, processes pending annotation files instead of a single source.

## Steps

1. **Read the source.** Whatever format (Markdown, plain text, PDF, JSONL). For PDFs/images, summarize what's there.

2. **Classify.** Pick one:
   - **Strategy / planning doc** — long-term plan, OKRs, roadmap.
   - **Organizational doc** — org chart, team structure, role definitions.
   - **Technical doc** — architecture, postmortem, runbook.
   - **Communication export** — Slack thread, email chain, chat history.
   - **Personal notes** — voice memo transcript, ad-hoc text capture.
   - **Reference material** — vendor docs, blog post, research paper.
   - **Annotations** — if input is a JSONL annotation file, use the [annotations sub-procedure](#annotations-sub-procedure).
   - **Meeting transcript** — abort and route to `/ingest-meeting`.

3. **Read thoroughly.** Extract:
   - Key facts.
   - Action items.
   - New entities mentioned (people, tools, vendors, frameworks).
   - Contradictions with existing brain content.

4. **Choose destination(s):**
   - **Brain (reusable knowledge):** search existing pages first. *Update beats create.* New pages only when the concept deserves its own identity.
   - **Artifact (point-in-time):** if the source is worth a polished output (e.g., a board-prep doc), craft into `out/<subfolder>/<slug>.html`.
   - **Both:** when the source deserves both preservation as an artifact and living updates in the brain.

5. **Write to `brain/`:**
   - For each durable item, identify or create the right page (see [`../../templates/constitution/knowledgebase.md`](../../templates/constitution/knowledgebase.md) for placement rules).
   - Add `<meta name="robin:source" content="inbox/...">` to each touched page. Multiple sources accumulate.
   - Inline provenance: see [`../lib/provenance.md`](../lib/provenance.md).
   - New pages start `state: needs-review`.

6. **Save memory events** for small durable cues (preferences, corrections, source-of-truth notes) via the memory.save mechanism. See [`../../format/memory-events.md`](../../format/memory-events.md).

7. **Create tasks** for action items via `/create-task`.

8. **Hub update (mandatory for named entities).** Every new tool / vendor / framework / org / pattern mentioned must:
   - Be linked from the relevant hub (or a new hub if there are now 3+ scattered references to its category).
   - Get a page if the source has enough substance for one.

9. **Update tracking:**
   - Append to `logs/ingest-log.md`:
     ```
     ## YYYY-MM-DDTHH:MM:SSZ — <classification> — <slug>
     source: <inbox-path>
     outputs: <comma-separated brain/out paths>
     entities: <names mentioned and linked>
     ```
   - Append to `logs/changelog.md`:
     ```
     ## [YYYY-MM-DD] ingest | <classification> — <one-line summary>
     ```
   - Update `brain/_index.html` if new top-level pages or hubs were created.

10. **Archive the source.** Move `inbox/<path>/file` → `inbox/archived/<path>/file`. (Don't delete.)

11. **Report:**
    ```
    Ingested: <source-path>
    Classification: <type>
    Pages created: N (state: needs-review)
    Pages updated: N
    Memory events: N
    Tasks: N
    Hubs touched: <list>
    Archive: inbox/archived/<path>/file
    ```

## Annotations sub-procedure

When called as `/ingest-source annotations`:

1. Scan `inbox/<tool>/annotations/` for files with unresolved annotations (events where `status` is not `resolved` or `rejected`).
2. For each annotation:
   - Read its `comment_md`, `page_path`, anchor.
   - Decide: is this a correction? A flag? An idea to capture?
   - **Correction** → memory event (`type: correction`), source `annotation`. Update the underlying page if the correction is actionable.
   - **Flag** → memory event (`type: other`), or update the page directly.
   - **Idea** → if substantive, promote to a page; if compact, memory event.
3. Emit a `memory.resolved` or analogous "resolved" event for each handled annotation (append, don't mutate).
4. Append to `logs/ingest-log.md` and `logs/changelog.md`.

## Output shape

Concise. Show what was ingested and where it went. The user shouldn't have to grep the logs.

## Edge cases

- **The source is huge.** Don't try to extract everything. Pick high-signal items. Note unprocessed content in the report.
- **The source conflicts with existing brain content.** Use append-with-history. Surface the conflict in the report.
- **The source is ambiguous about a date or person.** Mark `state: needs-review` and call it out.
- **The source is a duplicate of something already ingested.** Confirm before re-ingesting; usually skip.
- **A meeting transcript ended up in inbox without being identified as one.** Detect speaker labels or transcript shape; route to `/ingest-meeting`.
