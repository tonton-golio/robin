# inbox/

**This directory is immutable. Captures land here and stay.**

## What goes here

Anything coming from outside the brain that might become durable knowledge:

- Meeting transcripts → `inbox/meetings/YYYY-MM-DD-<slug>.md`
- Self-reflection / interview transcripts → `inbox/interviews/YYYY-MM-DD-<slug>.md`
- Document exports (PDF, DOCX, MD) → `inbox/docs/<source>/<filename>`
- Chat exports (Slack, etc.) → `inbox/<source>/YYYY-MM.jsonl`
- Browser annotation batches → `inbox/<tool>/annotations/YYYY-MM.jsonl`
- Personal scratch notes → `inbox/personal-notes/YYYY-MM/<slug>.md`

## Conventions

- **Don't edit.** Once a file lands here, it represents what arrived at that moment. Edits go to `brain/` (the derived durable knowledge).
- **Date-prefix when time-bound.** `2026-05-28-q3-planning.md` sorts naturally.
- **Subfolders carry source identity.** `inbox/notion-export/`, `inbox/slack/`, `inbox/personal-notes/`.
- **Move to `archive/` after ingestion.** When a source has been processed by `/ingest-source` or `/ingest-meeting`, it moves to `inbox/archived/<original-subpath>/`.

## Processing

| Source type | Skill to use |
|---|---|
| Meetings | `/ingest-meeting <path>` |
| Everything else | `/ingest-source <path>` |
| Annotations | `/ingest-source annotations` |

After ingestion, the durable knowledge lives in `brain/`. The source remains in `inbox/archived/` as the immutable record.
