# Writing

Style rules for pages, comments, and outgoing communication.

## Voice

- **Concise.** Lead with the answer. Reasoning second, if asked.
- **Direct.** No hedging. If you're uncertain, say "uncertain", don't bury it in qualifiers.
- **Dry.** No filler. No "great question." No emoji unless requested.
- **One idea per section.** Headings should reflect what's actually inside.
- **No throat-clearing.** Don't start with "In this section we will…". Start with the thing.

## File naming

- **Slugs** are kebab-case, lowercase, no special chars except hyphens.
- **Page filenames** are `<slug>.html`.
- **Date-stamped pages** (decisions, meetings, work logs): `YYYY-MM-DD-<slug>.html`.
- **Index pages**: `_index.html`.
- **Archive subfolders**: `archive/`.

## Frontmatter

Use `<meta name="robin:*">` tags. Required: `version`, `slug`, `path`, `type`, `updated`. Type-specific tags layer on top (see [`knowledgebase.md`](./knowledgebase.md) and the format reference).

- Tags are repeated, not comma-joined: `<meta name="robin:tag" content="a">`, `<meta name="robin:tag" content="b">`.
- `robin:summary` is one line, ≤120 chars.
- `robin:updated` bumps on meaningful content change, not formatting tweaks.

## Body style

- **Bullets** for lists. Not commas. Not numbered unless ordering matters.
- **Headings** sparingly. Default to `##` and `###`; deeper is usually a sign you should split the page.
- **Short paragraphs.** Two or three sentences. Wall of text → break it up.
- **No throat-clearing.** "This page is about X" — delete it. The title and summary tell you what it's about.

## Wikilinks

Every entity mention is a wikilink:

```html
<a data-wiki="jamie-doe" href="/p/jamie-doe">Jamie</a>
```

Plain-text mentions are invisible to backlinks. Even when the slug looks "obvious", wrap it.

Path-disambiguate only when needed:

```html
<a data-wiki="features/hero" href="/p/features/hero">hero feature</a>
```

For non-wiki files (transcripts, PDFs in `inbox/`):

```html
<a data-wiki="inbox/meetings/2026-05-28-team-retro.md" href="/p/inbox/meetings/2026-05-28-team-retro">retro transcript</a>
```

External URLs go in frontmatter (`<meta name="robin:url_github" …>`), not inline. Inline external links are fine in narrative prose; just use a normal `<a href>`.

## Provenance

Every durable claim has a source.

- **Single source:** `<meta name="robin:source" content="…">` in `<head>`, plus a one-line `> Source: <a data-wiki="…">…</a>` near the top of the body.
- **Multiple sources:** repeated `<meta name="robin:source" …>` in `<head>`, plus a `## Sources` section at the bottom of the body.

## Updating pages

When updating:

1. Update the body content.
2. Bump `<meta name="robin:updated" content="…">` to current ISO-8601 UTC.
3. If a fact conflicts with a prior fact, **append with history** — don't overwrite.

The history marker pattern:

```html
<p>Q3 priorities are now <strong>scale operations</strong> (decided 2026-05-28).</p>
<p>
  <em>(2026-04-10: original Q3 plan was launch new product, superseded 2026-05-28 by
  <a data-wiki="2026-05-28-q3-priority-shift" href="/p/2026-05-28-q3-priority-shift">Q3 priority shift</a>.)</em>
</p>
```

## What not to write

- **Comments inside HTML body explaining "what this section is for."** The heading does that. If it doesn't, fix the heading.
- **Multi-paragraph docstrings on pages.** A summary is one line. The body is the content.
- **"Final" or "draft" markers in titles.** Use `robin:state` for lifecycle.
- **Date stamps in titles** (except for date-prefixed file types like decisions and meetings). Dates belong in frontmatter.

## What to write more of

- **Headings** that match the actual content.
- **Wikilinks** where entities are mentioned.
- **`## Known gaps`** sections on hubs and playbooks.
- **One-line summaries** on every page.

## Style for outgoing communication

Outgoing messages (Slack, email) follow the same voice — concise, direct, no filler. Plus:

- **Signature** on every agent-sent message: `— {{AGENT_NAME}} ({{USER_NAME}}'s agent)` on its own line, preceded by a blank line.
- **Match recipient's voice.** If {{USER_NAME}} writes lowercase to a teammate, lowercase. If {{USER_NAME}} writes formal to an external partner, formal.
- **Slack formatting:** consecutive newlines collapse in Slack. To preserve a blank line between paragraphs, insert a zero-width space (`U+200B`) on the blank line.

See [`communications.md`](./communications.md) for the full outgoing-message contract.
