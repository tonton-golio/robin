# logs/

**Operational record. Append-only.**

## What goes here

### Append-only Markdown logs

- **`changelog.md`** — reverse-chronological journal of every `/learn`, restructure, promotion, task creation, lint pass, ingest. The "what happened" trail.
- **`ingest-log.md`** — every `/ingest-*` invocation. Source → outputs mapping. The "where did this come from" trail.
- **`repo-log.md`** — repo/tooling changes (framework edits, dependency bumps, build/infra tweaks). The "what changed in the code" trail, distinct from brain knowledge.

All three are required by `robin/scripts/doctor.sh` (the `top-level logs exist` check), so seed them on a fresh install even if empty.

### Generated HTML reports

- **`daily/YYYY-MM-DD.html`** — per-day session summaries (written by the daily-log hook).
- **`remsleep/YYYY-MM-DD.html`** — end-of-day consolidation reports.
- **`meetings/YYYY-MM-DD-<slug>.html`** — meeting summary pages (from `/ingest-meeting`).
- **`reports/YYYY-MM-DD-<kind>.html`** — morning briefs, weekly reviews, lint reports.

### Sentinels

- **`.last-learn`** — zero-byte sentinel touched by `/learn`. Read by the PreCompact hook.

## Conventions

- **Append-only.** Never edit history in `changelog.md` or `ingest-log.md`. If you need to correct an old entry, append a new entry referencing the old one.
- **Reverse-chronological.** Newest entries go at the top of `changelog.md` and `ingest-log.md`.
- **Entry format** (changelog):
  ```markdown
  ## [YYYY-MM-DD] <verb> | <one-line summary>

  What happened. Link affected pages.
  ```
  Verbs: `ingest`, `create`, `update`, `restructure`, `lint`, `enrich`, `remsleep`, `task`, `hub`, `archive`. Multiple separated by `+`.
- **Entry format** (ingest-log):
  ```markdown
  ## YYYY-MM-DDTHH:MM:SSZ — <classification> — <slug>
  source: <inbox-path>
  outputs: <comma-separated brain/out paths>
  entities: <names mentioned and linked>
  ```

## Why this matters

The brain is only as trustworthy as the audit trail. With these logs you can always answer:

- What changed yesterday? → grep `[YYYY-MM-DD]` in `changelog.md`.
- Where did this brain page come from? → grep the slug in `ingest-log.md`.
- What sources have been ingested this month? → scan `ingest-log.md` headers.

Without these logs, the brain is opaque. With them, it's auditable.
