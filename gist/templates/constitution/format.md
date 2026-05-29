# Format — the durable storage contract

The brain is HTML. The contract is locked.

## Boundary

- **Canonical durable content:** `brain/**/*.html`, active `out/**/*.html`, generated `logs/**/*.html`.
- **Authoring input only:** Markdown is allowed in `inbox/` (raw captures) and `logs/*.md` (append-only operational logs).
- **Structured recall:** `brain/memory/events.jsonl` (append-only).

Everything else (drafts, scratch notes, side projects) lives outside `brain/` until promoted.

## Why HTML

- `<meta name="robin:*">` tags carry indexed metadata. YAML frontmatter is fragile.
- Pages render directly in browsers. No build step.
- Canonicalization is deterministic: two saves produce the same bytes.
- The format supports first-class affordances (wikilinks, callouts, tasks, hubs) without inventing Markdown extensions.

## Page skeleton

Every page is a complete HTML5 document with:

```html
<!doctype html>
<html lang="en">
<head>
  <title>…</title>
  <link rel="canonical" href="/p/{slug}">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="{slug}">
  <meta name="robin:path" content="{vault-relative-path}">
  <meta name="robin:type" content="{type}">
  <meta name="robin:updated" content="{ISO-8601 UTC}">
  <meta name="robin:summary" content="{one-line}">
  <!-- optional: robin:state, robin:owner, robin:tag (repeatable), robin:source (repeatable) -->
</head>
<body>
  <article data-robin-doc>
    <!-- canonical body HTML -->
  </article>
</body>
</html>
```

Required meta tags: `version`, `slug`, `path`, `type`, `updated`.

Type-specific tags layer on top (tasks need `status`, `priority`, `due`; people need `relationship`; meetings need `date`, `attendee`). The full reference is in [`knowledgebase.md`](./knowledgebase.md) and (in any setup with a format spec doc) the gist's [`format/frontmatter-reference.md`](../../robin-gist/format/frontmatter-reference.md).

## Authoring surface

You may author pages in two ways:

1. **Markdown templates** (`.claude/templates/wiki-*.md` if you maintain them) → converter → canonical HTML.
2. **Direct HTML** — write the page in HTML, save with the required `<meta>` tags.

When using Markdown, treat templates as *pre-converter aids*. The durable artifact is always the HTML output. Do not commit Markdown to `brain/`.

## Wikilinks

Internal references use:

```html
<a data-wiki="slug" href="/p/slug">link text</a>
```

- `data-wiki` is canonical.
- `href` is computed from `data-wiki` at save time.
- Resolution searches by slug across the vault.

For unambiguous slugs, use the bare form. For ambiguous slugs, path-disambiguate: `data-wiki="folder/slug"`.

Wikilink rewriting does **not** recurse into `<code>` or `<pre>` blocks.

## Canonicalization

Every save passes through a canonicalize step:

1. Sort `<meta>` tags by name, then by content.
2. Sort repeated tag values (e.g., all `robin:tag` values) lexically.
3. Rewrite wikilink `href` from `data-wiki`.
4. Alphabetize `data-*` attributes within elements.
5. Pretty-print with strict whitespace preservation inside `<pre>` and `<code>`.

Result is idempotent: `canonicalize(canonicalize(x)) == canonicalize(x)`.

In a lightweight setup (no MCP server), be consistent. In a powered-up setup (with the MCP server), every save is canonicalized for you.

## Memory layer (sidecar)

`brain/memory/events.jsonl` is **append-only** and structured. One JSON object per line. Three event kinds: `memory.saved`, `memory.seen`, `memory.resolved`.

Memory events are *compact recall cues* — preferences, corrections, small dated facts, source-of-truth notes. They are **not** a replacement for canonical HTML pages. If something deserves a paragraph, write a page. See [`learning.md`](./learning.md) for the boundary.

## Operational logs (Markdown OK)

Two log files are append-only Markdown:

- `logs/changelog.md` — every `/learn`, restructure, promotion, task creation, lint pass. Reverse-chronological.
- `logs/ingest-log.md` — every `/ingest-*` invocation. Source → outputs mapping.

Generated HTML in `logs/` (daily summaries, remsleep reports, meeting summaries, briefs) follows the same Robin format as brain pages.

## What's forbidden

- **Markdown in `brain/`.** Never commit `.md` files in `brain/`. Authoring in Markdown is fine; the artifact is HTML.
- **JSON inside pages.** No `<script type="application/json">…</script>` blocks. Use `<meta>` tags for structured data.
- **Edits to `inbox/`.** Inbox is immutable.
- **Deletes without archiving.** Move to `archive/` (or trash with a timestamp). Never `rm -rf` a brain page.

## Retrieval surfaces

When looking for knowledge:

1. **`brain/_index.html`** — the master map.
2. **Direct file reads** by path.
3. **`grep` / `rg`** scoped to `brain/`.
4. **MCP search** (in a powered-up setup): `knowledge.search`, `memory.search`, `page.search`.

Memory events surface fast and cheaply; pages provide depth. Use both.

## Migration history

The current spec is **v0.2**. (v0.1 used embedded JSON blocks; those are no longer in use.) Future revisions will bump `robin:version` and document the diff.
