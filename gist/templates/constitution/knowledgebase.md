# Knowledgebase — brain layout and rules

The brain is the durable canonical knowledge surface. This file defines its structure, placement rules, frontmatter requirements, and the hub standard.

## Top-level structure

```
brain/
├── _index.html              # Master map. Updated on every restructure.
├── projects/                # One folder per workstream.
├── repos/                   # Registry of code repositories.
├── tools/                   # Internal tools, services, infra.
├── people/
│   ├── team/                # Direct reports, peers.
│   ├── stakeholders/        # Partners, leadership, external.
│   └── candidates/          # Historical hiring (mostly archived).
├── about_user/              # Personal context about {{USER_NAME}}.
├── playbooks/               # Step-by-step procedures.
├── patterns/                # Named recurring approaches.
├── standards/               # Explicit rules committed to.
├── decisions/               # YYYY-MM-DD-slug.html decision records.
├── unknowns/                # Open questions worth tracking.
├── hubs/                    # Thin navigational indexes.
├── tasks/                   # Open work items.
├── annotations/             # Browser highlights, comments worth following up.
├── memory/
│   ├── _index.html
│   └── events.jsonl         # Append-only compact recall.
├── strategy/                # Long-term plans, scorecards.
└── work-log/                # Append-only monthly work history.
```

## Placement rules

| Knowledge type | Where it goes |
|---|---|
| Workstream with goals + lifecycle | `brain/projects/<slug>/` |
| Code repository registry | `brain/repos/<repo>.html` |
| Internal tool / service | `brain/tools/<tool>.html` |
| Person on the team | `brain/people/team/<first-last>.html` |
| External stakeholder | `brain/people/stakeholders/<first-last>.html` |
| Procedure (steps to execute) | `brain/playbooks/<slug>.html` |
| Recurring approach (descriptive) | `brain/patterns/<slug>.html` |
| Rule committed to (prescriptive) | `brain/standards/<slug>.html` |
| Decision made on a date | `brain/decisions/YYYY-MM-DD-<slug>.html` |
| Open question | `brain/unknowns/<slug>.html` |
| Navigational topic index | `brain/hubs/<slug>.html` |
| Open work item | `brain/tasks/<slug>.html` |
| Compact recall cue | `brain/memory/events.jsonl` (one JSON line) |
| Long-term plan | `brain/strategy/<slug>.html` |
| Monthly work record | `brain/work-log/YYYY-MM.html` |

When unsure, ask: *where would a future query for this find it on the first hop?* That's the answer.

## Page metadata requirements

Every page has a `<head>` with at least these meta tags:

```html
<meta name="robin:version" content="0.2">
<meta name="robin:slug" content="{slug}">
<meta name="robin:path" content="{vault-relative-path}">
<meta name="robin:type" content="{type}">
<meta name="robin:updated" content="{ISO-8601 UTC}">
```

Plus `robin:summary` (almost always), `robin:state` (where lifecycle matters), `robin:tag` (repeated, one per tag), and type-specific tags (e.g., `robin:status` for tasks, `robin:date` for decisions and meetings, `robin:relationship` for people).

See [`format.md`](./format.md) for the full skeleton, and the gist's [`format/frontmatter-reference.md`](../../robin-gist/format/frontmatter-reference.md) for the full meta-tag table.

## State semantics

Three trust levels:

- **`needs-review`** — newly written. Not yet vetted for overlap or accuracy. Default state for `/learn` output.
- **`stable`** — reviewed and kept. Well-linked, substantive. The everyday trust level.
- **`canonical`** — source-of-truth. Rare. Reserved for core standards, identity-shaping facts, decisions that the rest of the system anchors on.

`/remsleep` Phase 3 promotes solid `needs-review` pages → `stable`. Promotion to `canonical` is deliberate, by {{USER_NAME}}.

## Hub standard

A hub is a thin, opinionated index page for a recurring topic. Examples:

- `brain/hubs/llm-providers.html`
- `brain/hubs/agent-frameworks.html`
- `brain/hubs/internal-tools.html`

A hub:

- Has a one-line summary in `robin:summary` describing the scope.
- Lists entries grouped by maturity: in-production, candidate-signal, legacy (or analogous groupings).
- Each entry: bold name, one-line opinionated description, wikilinks to the substantive page.
- **Ends with a `## Known gaps` section** listing what's not covered yet. This enforces honest incompleteness.
- Carries `robin:last_reconciled` (ISO-8601 date). Reconcile every 14 days; `/lint-wiki` flags older.

A hub is **not authoritative**. The substance lives in the linked pages.

Create a new hub when you have 3+ scattered references to a topic. Merge hubs when two cover overlapping ground.

## Source provenance

Every durable claim should be traceable to its source.

- **Single source** → use `<meta name="robin:source" content="inbox/path/to/source">` in `<head>`, AND a single-line `> Source: <a data-wiki="…">…</a>` near the top of the body.
- **Multiple sources** → use repeated `<meta name="robin:source" …>` tags in `<head>`, AND a `## Sources` section at the bottom of the body with a list.

When a page combines knowledge from multiple sources, prefer the multi-source pattern. Provenance is load-bearing.

## Update beats forking

Before creating a new page, **search existing ones**. Updating an existing page is almost always better than forking. Duplicates fragment recall.

When facts conflict (old fact vs. new fact), **never overwrite silently**. Append the new fact with a date. Mark the old fact with its original date + `(superseded YYYY-MM-DD by [[link]])`. The trail is the evidence.

## Repos and the `repos/` bridge

If {{USER_NAME}} works in code repositories, each one gets a brain page at `brain/repos/<repo>.html`:

- One-line description.
- Architecture summary.
- Key files and entry points.
- Where logs and deploys live.
- Local conventions (defer to the repo's own `CLAUDE.md` / `AGENTS.md` for code-style rules).

The page is a *bridge*. Durable conclusions from working in the repo (architectural decisions, recurring bugs, learned constraints) belong here.

## About-user pages

The `brain/about_user/` folder holds personal context about {{USER_NAME}}:

- `communication-style.html` — how {{USER_NAME}} likes to be talked to.
- `values.html` — what {{USER_NAME}} optimizes for.
- `working-hours.html` — availability windows and urgency model.
- `known-blindspots.html` — patterns {{USER_NAME}} wants you to push back on.
- `reflections/` — durable reflection capture (gated by `self_reflection: true`).

Treat these as the agent's personal field guide. The more honest, the more useful.

## Annotations

If {{USER_NAME}} reads in a tool that emits highlights / comments (or you have such a tool), annotations land as JSONL in `inbox/<tool>/annotations/YYYY-MM.jsonl`. They are processed by `/ingest-source annotations` into:

- Memory events (for small corrections).
- Page edits (for actionable annotations).
- Tasks (for follow-up actions).

Once processed, the annotation is marked `resolved` (in place in the JSONL — append a `resolved` event rather than mutating). Browser annotations are immutable.

## Lookup discipline

Before creating, **search**.

- Match by slug.
- Match by tag.
- Match by topic via hub.

A duplicate is more expensive than a few extra search keystrokes.
