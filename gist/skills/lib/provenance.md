# Provenance conventions

Used by `/learn`, `/ingest-source`, `/ingest-meeting`, and any skill that writes durable knowledge from a source.

Every durable claim should be traceable to its origin. This file defines the canonical strings and placement rules.

## Two surfaces

Provenance appears in **two places** on a page:

1. **`<meta name="robin:source" content="...">`** in `<head>`. One per source. Used by indexers and search.
2. **Inline in the body.** Human-readable. Either a single-line quote near the top or a `## Sources` section at the bottom.

## Single-source page

When a page derives from one source:

```html
<head>
  ...
  <meta name="robin:source" content="inbox/meetings/2026-05-28-q3-planning.md">
  ...
</head>
<body>
  <article data-robin-doc>
    <h1>...</h1>
    <blockquote>
      <p>Source: <a data-wiki="inbox/meetings/2026-05-28-q3-planning.md" href="/p/inbox/meetings/2026-05-28-q3-planning">Q3 planning meeting</a></p>
    </blockquote>
    ...
  </article>
</body>
```

## Multi-source page

When a page synthesizes from multiple sources:

```html
<head>
  ...
  <meta name="robin:source" content="inbox/meetings/2026-04-22-q2-planning.md">
  <meta name="robin:source" content="inbox/meetings/2026-05-28-q3-planning.md">
  <meta name="robin:source" content="inbox/docs/board-deck-may.pdf">
  ...
</head>
<body>
  <article data-robin-doc>
    <h1>...</h1>
    ...

    <h2>Sources</h2>
    <ul data-block="bulletList">
      <li><a data-wiki="inbox/meetings/2026-04-22-q2-planning.md" href="/p/inbox/meetings/2026-04-22-q2-planning">Q2 planning (2026-04-22)</a></li>
      <li><a data-wiki="inbox/meetings/2026-05-28-q3-planning.md" href="/p/inbox/meetings/2026-05-28-q3-planning">Q3 planning (2026-05-28)</a></li>
      <li><a data-wiki="inbox/docs/board-deck-may.pdf" href="/p/inbox/docs/board-deck-may">May board deck</a></li>
    </ul>
  </article>
</body>
```

## Source kinds

For memory events, the `source` object carries a `kind`:

- `manual` — explicitly entered by the user.
- `annotation` — from a browser highlight or comment.
- `conversation` — from session chat.
- `meeting` — from a meeting transcript.
- `tool` — from a tool output (e.g., a script's stderr).
- `repo` — from a code file or git history.

Always include a `captured_at` ISO-8601 timestamp. Include a `quote` when the exact wording matters (preferences, corrections).

## Adding to an existing page

When updating a page with new material from a new source:

1. Add a new `<meta name="robin:source" …>` tag to `<head>`.
2. If the body has a `<blockquote>` Source line at the top, convert to a `## Sources` section at the bottom.
3. If a `## Sources` section already exists, append a new bullet.

Never remove a source. Even if the original source is now archived, keep the reference — the chain matters.

## What counts as a source

| Material | Path |
|---|---|
| Meeting transcript | `inbox/meetings/YYYY-MM-DD-<slug>.md` |
| Interview / self-reflection | `inbox/interviews/YYYY-MM-DD-<slug>.md` |
| Document export (PDF, doc) | `inbox/docs/<source>/<filename>` |
| Slack export | `inbox/slack/YYYY-MM.jsonl` |
| Browser annotation batch | `inbox/<tool>/annotations/YYYY-MM.jsonl` |
| Live conversation | `conversation:session-YYYY-MM-DD` (free-form ref) |
| Tool output | `tool:<tool-name>:<timestamp>` |
| Code commit | `repo:<repo-slug>:<commit-sha>` |

## What does NOT count as a source

- Speculation. ("I think we discussed this somewhere…") If the source is uncertain, mark the page state `needs-review` and leave the `robin:source` empty rather than fabricate.
- Other brain pages. Brain pages link to each other via wikilinks, not via `robin:source`. Reserve `robin:source` for material from outside `brain/`.
