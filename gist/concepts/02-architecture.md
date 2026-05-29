# 02 — Architecture

The Robin pattern is a **file system layout** plus a **set of contracts** about what goes where. The architecture is intentionally boring: just folders, just files.

## The top-level split: vault vs. framework

The repo has two halves, and keeping them apart is load-bearing:

- A **vault** directory holds all your personal data: `brain/`, `inbox/`, `logs/`, `out/`, and the gitignored `.robin/` runtime sidecar. Its location is set by the **`ROBIN_VAULT`** environment variable. This kit uses **`base/`** as the default name (mirroring the system it came from), but the name is yours — `ROBIN_VAULT` is the single source of truth that the app, MCP server, and `doctor.sh` all read.
- A **framework** directory (`robin/`) holds everything shareable and impersonal: the app, this gist, the operational scripts, and experiments.

Why the split? The framework is the part you can hand to a teammate or publish. The vault is the part you must scrub before sharing (see [`../SCRUBBING.md`](../SCRUBBING.md)). Mixing them means every share risks leaking salaries, channel IDs, and stakeholder names. Separating them lets you share `robin/` freely and keep `base/` private.

```
your-repo/
├── CLAUDE.md                       # Entry-point constitution. Every session reads this first.
├── .mcp.json                       # Registers the Robin MCP server with ROBIN_VAULT.
├── Makefile                        # Convenience targets: `make robin-ui`, `make doctor`.
├── .claude/
│   ├── settings.json               # Hooks, permissions.
│   ├── constitution/               # 14 files. The agent's law.
│   │   ├── identity.md
│   │   ├── guide.md
│   │   ├── format.md
│   │   ├── config.yaml
│   │   ├── knowledgebase.md
│   │   ├── learning.md
│   │   ├── tasks.md
│   │   ├── daily-rhythm.md
│   │   ├── maintenance.md
│   │   ├── writing.md
│   │   ├── communications.md
│   │   ├── conversation-style.md
│   │   ├── retrieval.md
│   │   └── context-continuity.md
│   ├── skills/                     # Slash commands. One folder per skill.
│   │   ├── learn/SKILL.md
│   │   ├── morning-brief/SKILL.md
│   │   ├── remsleep/SKILL.md
│   │   ├── ingest-source/SKILL.md
│   │   ├── ingest-meeting/SKILL.md
│   │   ├── lint-wiki/SKILL.md
│   │   ├── check-tasks/SKILL.md
│   │   ├── create-task/SKILL.md
│   │   └── lib/                    # Shared conventions used by multiple skills.
│   └── hooks/                      # Session lifecycle scripts (pre-compact.sh, daily-log.sh).
│
├── base/                           # ← THE VAULT. Name is set by ROBIN_VAULT (default: base/).
│   ├── brain/                      # Canonical durable knowledge.
│   │   ├── _index.html             # Master map. Updated on every restructure.
│   │   ├── projects/               # Workstreams. One folder per project.
│   │   ├── people/
│   │   │   ├── team/               # Direct reports, peers.
│   │   │   ├── stakeholders/       # Partners, leadership, external.
│   │   │   └── candidates/         # Historical hiring (archived).
│   │   ├── decisions/              # YYYY-MM-DD-slug.html decision records.
│   │   ├── patterns/               # Recurring approaches.
│   │   ├── playbooks/              # Step-by-step procedures.
│   │   ├── standards/              # Rules you commit to.
│   │   ├── hubs/                   # Thin navigational indexes by topic.
│   │   ├── tasks/                  # Open work items.
│   │   ├── strategy/               # Long-term plans, scorecards.
│   │   ├── repos/                  # Registry of code repositories.
│   │   ├── tools/                  # Internal tools and infra.
│   │   ├── memory/
│   │   │   ├── _index.html
│   │   │   └── events.jsonl        # Append-only compact recall.
│   │   ├── annotations/            # Browser highlights/comments worth following up.
│   │   ├── unknowns/               # Open questions worth tracking.
│   │   ├── work-log/               # Monthly retained work history.
│   │   └── about_user/             # Personal context about the primary user (renamable; see SCRUBBING.md).
│   │
│   ├── inbox/                      # Immutable raw captures. Append-only.
│   │   ├── meetings/               # Transcripts, audio.
│   │   ├── archived/               # Processed sources, moved here after ingest.
│   │   └── (other ad-hoc subfolders)
│   │
│   ├── logs/                       # Operational record. Append-only.
│   │   ├── changelog.md            # Reverse-chronological journal of edits.
│   │   ├── ingest-log.md           # Source → output mapping.
│   │   ├── daily/                  # Per-day session summaries (HTML).
│   │   ├── remsleep/               # End-of-day consolidation reports.
│   │   ├── meetings/               # Generated meeting summary pages.
│   │   ├── reports/                # Morning briefs, weekly reviews.
│   │   └── .last-learn             # Sentinel touched by /learn (used by hook).
│   │
│   ├── out/                        # Polished artifacts for humans.
│   │   ├── plans/
│   │   ├── presentations/
│   │   └── reports/
│   │
│   └── .robin/                     # Gitignored runtime sidecar: index.db (SQLite), rendered cache.
│
└── robin/                          # ← THE FRAMEWORK. Shareable; no personal data.
    ├── app/                        # Next.js web UI + converter + indexer + MCP server (see ../app-setup.md).
    ├── gist/                       # This starter kit.
    └── scripts/                    # doctor.sh and other operational helpers.
```

> Note on hook paths: the hook scripts default `VAULT` to `$CLAUDE_PROJECT_DIR` (the **repo root**, not the vault). They write to `logs/` relative to that. If your vault is a subdirectory like `base/`, point the hooks at `$CLAUDE_PROJECT_DIR/base` (or set the env so they resolve to the vault). See [`../setup.md`](../setup.md) Step 7.

## The contracts

### Contract 1: durability boundary

| Surface | Format | Mutability |
|---|---|---|
| `brain/**/*.html` | HTML only (with `<meta name="robin:*">`) | Edited iteratively. Canonical. |
| `out/**/*.html` | HTML only | Edited iteratively. Audience-tailored. |
| `brain/memory/events.jsonl` | JSONL | Append-only. |
| `inbox/**` | Anything | **Immutable** after landing. |
| `logs/changelog.md`, `logs/ingest-log.md` | Markdown | **Append-only.** Never edit history. |
| `logs/daily/`, `logs/remsleep/`, etc. | HTML | Generated; treat as immutable. |
| `.claude/**` | Markdown / YAML | Edited deliberately; treat as code. |

### Contract 2: page anatomy

Every page in `brain/` and active `out/` is a full HTML5 document with this skeleton:

```html
<!doctype html>
<html lang="en">
<head>
  <title>...</title>
  <link rel="canonical" href="/p/{slug}">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="{slug}">
  <meta name="robin:path" content="{vault-relative-path}">
  <meta name="robin:type" content="{type}">
  <meta name="robin:state" content="{state}">
  <meta name="robin:updated" content="{ISO-8601 UTC}">
  <meta name="robin:summary" content="{summary}">
  <meta name="robin:tag" content="..."> <!-- repeat as needed -->
</head>
<body>
  <article data-robin-doc>
    <!-- canonical body HTML -->
  </article>
</body>
</html>
```

Full reference: [`../format/page-format.md`](../format/page-format.md).

### Contract 3: wikilinks

Internal links use a stable form:

```html
<a data-wiki="slug-only" href="/p/slug-only">link text</a>
```

The `data-wiki` attribute is canonical. `href` is rewritten at save time. Resolution is by slug across the vault — no folder path required.

### Contract 4: memory events

`brain/memory/events.jsonl` is one JSON object per line, append-only:

```json
{"event":"memory.saved","memory":{"id":"...","type":"...","tier":"semantic","status":"active","subject":"...","summary":"...","sources":[...],"created_at":"...","updated_at":"...","fingerprint":"..."}}
```

Full schema: [`../format/memory-events.md`](../format/memory-events.md).

### Contract 5: pipeline direction

```
inbox/ → brain/ → out/
        ↓
       logs/
```

- Sources land in `inbox/`. They are immutable.
- Ingest skills (`/ingest-source`, `/ingest-meeting`) extract durable knowledge into `brain/` and write a row to `logs/ingest-log.md` pointing source → output.
- `/learn` and other skills update `brain/` based on what's happening in conversation, and write a row to `logs/changelog.md`.
- `out/` artifacts are crafted *from* `brain/` material when you need to brief humans.

The arrow points one way. Edits to `brain/` don't propagate back to `inbox/`. Once an `out/` artifact is shipped, it's a snapshot; the brain keeps evolving.

## The minimum viable layout

If you want to start small, you only need (with `base/` as your `ROBIN_VAULT`):

```
your-repo/
├── CLAUDE.md
├── .claude/constitution/        # all 14 files
├── .claude/skills/learn/        # just /learn to start
└── base/
    ├── brain/_index.html
    ├── brain/decisions/
    ├── brain/people/
    ├── brain/projects/
    ├── brain/tasks/
    ├── brain/memory/events.jsonl
    ├── inbox/
    ├── logs/changelog.md
    └── out/
```

Add more skills, more directories, more hubs as the work calls for them. **Do not pre-build empty structure.** Empty folders confuse the agent — it tries to populate them on bad signals. Create only the few directories you have a real first entry for; let the rest appear when you need them.

## The optional power-up

The lightweight pattern uses files directly. The agent reads `brain/_index.html` and walks the file tree. This works.

There is a heavier flavor that uses an **MCP server** to expose tools like `page_read`, `page_write`, `memory_save`, `knowledge_search`. Same files; different access path. Advantages:

- Indexed search (SQLite FTS5 + optional vector embeddings).
- Enforced canonicalization (consistent whitespace, sorted meta tags, normalized wikilinks).
- Batch operations.
- A web UI for browsing the brain in a browser.

**This MCP server and web UI ship in this kit** — they live at `robin/app` (a Next.js + TypeScript monorepo: `packages/converter`, `packages/indexer`, `packages/mcp-server`, `apps/web`). The file format here is identical to what the app consumes, so you can start with the lightweight setup and turn on the app later without touching your brain content. See [`../app-setup.md`](../app-setup.md) for the full wiring. (Earlier revisions of this gist described the app as "a separate codebase, not in this gist" — that is no longer true.)

## Why this layout

A few questions answered:

**Why is `inbox/` separate from `brain/`?** Because raw capture and durable knowledge have different lifecycles. Captures are append-only history; durable knowledge is a living document. Mixing them muddles both.

**Why is `out/` separate from `brain/`?** Because audience matters. A brain page is for you and the agent — terse, well-linked, technical. An `out/` artifact is for stakeholders — styled, narrative, polished. Conflating them either over-styles internal notes or under-details external deliverables.

**Why a `logs/` folder at all?** Because the only way to trust a knowledge base is to be able to ask "where did this come from?" `logs/ingest-log.md` answers that. `logs/changelog.md` answers "what changed?" These are the audit trails that keep the brain trustworthy.

**Why HTML?** See [`01-philosophy.md`](./01-philosophy.md#2-html-is-the-durable-form-markdown-is-input). Short answer: structured metadata, browser-renderable, strict canonicalization.

Continue: [`03-information-architecture.md`](./03-information-architecture.md).
