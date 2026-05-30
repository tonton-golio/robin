# Page format (v0.2)

This is the canonical specification for durable pages in `brain/` and active `out/`. Every page is a complete HTML5 document. The contract surface is:

1. The HTML skeleton.
2. The `<meta name="robin:*">` tags carrying indexed metadata.
3. The `<article data-robin-doc>` body wrapper.
4. The wikilink form.
5. The canonicalization rules.

## The skeleton

Every page is a full HTML document. No exceptions:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Page title</title>
  <link rel="canonical" href="/p/page-slug">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="page-slug">
  <meta name="robin:path" content="brain/area/page-slug.html">
  <meta name="robin:type" content="project">
  <meta name="robin:state" content="stable">
  <meta name="robin:updated" content="2026-05-28T14:32:00Z">
  <meta name="robin:summary" content="One-line summary, ≤120 chars.">
  <meta name="robin:tag" content="example-tag">
  <meta name="robin:tag" content="another-tag">
</head>
<body>
  <article data-robin-doc>
    <h1>Page title</h1>
    <p>Body content goes here…</p>
  </article>
</body>
</html>
```

## Required meta tags

These five tags must be present on every page:

| Tag | Type | Notes |
|---|---|---|
| `robin:version` | string | Spec version. Currently `0.2`. |
| `robin:slug` | string | Kebab-case basename. Need not be globally unique — `robin:path` is the identity. |
| `robin:path` | string | Vault-relative path. E.g., `brain/projects/site-rebuild/site-rebuild.html`. |
| `robin:type` | enum | See [type vocabulary](#type-vocabulary) below. |
| `robin:updated` | ISO-8601 UTC | E.g., `2026-05-28T14:32:00Z`. Set on every save. |

## Optional meta tags

| Tag | Type | Notes |
|---|---|---|
| `robin:state` | enum | `needs-review` \| `stable` \| `canonical` \| `archived` \| `evolving` \| `draft`. |
| `robin:created` | ISO-8601 UTC | Set once on create. |
| `robin:summary` | string | One-line summary surfaced in search results and indexes. |
| `robin:owner` | string | Person responsible. Free-form name or slug. |
| `robin:tag` | string (repeatable) | One per tag. **Never comma-joined.** |
| `robin:source` | string (repeatable) | Vault-relative paths to inbox source files. |

## Type-specific tags

### Tasks (`type=task`)

| Tag | Notes |
|---|---|
| `robin:status` | `open` \| `in-progress` \| `done` \| `blocked` \| `dropped` \| `superseded` \| `cancelled`. **Use `status`, not `state`.** |
| `robin:priority` | `p0` \| `p1` \| `p2` \| `p3`. |
| `robin:due` | ISO-8601 date. E.g., `2026-06-15`. |
| `robin:workflow` | `inbox` \| `next` \| `active` \| `waiting` \| `review` \| `scheduled` \| `backlog`. |
| `robin:project` | Project slug. |
| `robin:category` | Optional. Free-form. |

### People (`type=person`)

| Tag | Notes |
|---|---|
| `robin:role` | Free-form. |
| `robin:relationship` | `direct-report` \| `stakeholder` \| `external` \| `candidate`. |
| `robin:started` | ISO-8601 date. |

### Meetings, briefs, reports

| Tag | Notes |
|---|---|
| `robin:date` | ISO-8601 date. |
| `robin:attendee` | Repeatable, one per attendee. |
| `robin:duration` | E.g., `"45 min"`. |

### Memory tier (for pages cross-referenced from memory events)

| Tag | Notes |
|---|---|
| `robin:tier` | `working` \| `episodic` \| `semantic` \| `procedural`. Usually computed; override sparingly. |

## Type vocabulary

The full enum for `robin:type`:

```
task | person | project | knowledge | understanding | reference | tool | repo |
decision | meeting | interview | brief | report | remsleep | reflection |
index | template | skill | playbook | work-log | note | hub | standard | pattern
```

If you find yourself wanting a type not on this list, prefer composing (`type: knowledge`, `tag: <your-domain>`) over inventing a new type. Add to the enum only when an entirely new category emerges.

## State vocabulary

For non-task `robin:state`:

| State | When |
|---|---|
| `needs-review` | Newly created. Not yet vetted for overlap or accuracy. |
| `stable` | Reviewed and kept. Well-linked. Everyday trust. |
| `canonical` | Source-of-truth. Rare. Reserved for core standards, identity-shaping facts. |
| `evolving` | Knowingly in flux. Will change. |
| `draft` | Work in progress; expect bugs. |
| `archived` | Retired. Kept for history. |

For task `robin:status`: see [Tasks](#tasks-typetask).

## The body wrapper

The body must contain exactly one root element:

```html
<article data-robin-doc>
  <!-- canonical body HTML -->
</article>
```

Nothing else inside `<body>`. No floating script tags, no wrapping divs, no nav bars. The body wrapper makes the canonical content trivially extractable.

## Wikilinks

Internal links use this form:

```html
<a data-wiki="slug" href="/p/slug">link text</a>
```

- The `data-wiki` attribute is **canonical**.
- The `href` is **rewritten** at save time from `data-wiki`.
- Slug resolution searches by `robin:slug` across the vault.

For path-disambiguated links (when two pages share a slug):

```html
<a data-wiki="features/images" href="/p/features/images">images feature</a>
```

The resolver tries:

1. If `data-wiki` ends in `.html`, exact path match against `robin:path`.
2. If `data-wiki` contains `/`, path-suffix match against `robin:path`.
3. Otherwise, bare slug match against `robin:slug`.
4. Ambiguous → mark `data-broken="ambiguous"`.
5. No match → mark `data-broken="missing"`. (Renders red.)

Full wikilink reference: [`wikilinks.md`](./wikilinks.md).

## Block-level affordances

Semantic block hints use `data-block="<kind>"`:

```html
<p data-block="paragraph">…</p>
<h2 data-block="heading">…</h2>
<ul data-block="bulletList">…</ul>
<ul data-block="taskList">…</ul>
<li data-block="task" data-checked="false">…</li>
<pre data-block="codeBlock" data-lang="ts">…</pre>
<blockquote data-block="quote">…</blockquote>
<aside data-callout="info">…</aside>
<figure data-embed="image"><img src="…" alt=""></figure>
<ul data-block="hubChildren" data-query="type:tool tag:llm"></ul>
```

The `data-block` attribute is *optional* — plain `<p>`, `<ul>`, etc. still work. Use the attribute when downstream tooling needs to distinguish (e.g., when rendering, when computing word counts that exclude code).

## Code blocks

```html
<pre data-lang="python"><code>def hello():
    return "world"
</code></pre>
```

Wikilink rewriting **must not** recurse into `<code>`. Text inside `<code>` is literal.

## Callouts

```html
<aside data-callout="warning">
  <p>Heads up: this is a warning.</p>
</aside>
```

Common types: `info`, `warning`, `caution`, `note`, `tip`.

## Hub children listings

A hub page can declare a query that gets filled at view time, not baked into HTML:

```html
<ul data-block="hubChildren" data-query="type:project tag:active"></ul>
```

The hub query is rendered by the viewer (or the MCP server) — it expands at read time, not write time. This keeps hubs fresh.

## Canonicalization

Every save passes through a canonicalize step:

1. Parse the HTML.
2. **Sort `<meta>` tags** by name, then by content (lexical).
3. **Sort repeated tag values** lexically (e.g., all `robin:tag` values in order).
4. **Rewrite wikilink `href`** attributes from `data-wiki`.
5. **Alphabetize `data-*` attributes** within elements.
6. Pretty-print HTML with strict whitespace preservation inside `<pre>` and `<code>`.

The result is *idempotent*: `canonicalize(canonicalize(x)) == canonicalize(x)`.

Why this matters: two agents writing the same content produce the same bytes. Git diffs are meaningful. Format drift is impossible.

If you're writing pages by hand (or with a script), pass them through whatever canonicalization tool your power-up uses, or accept slight differences. In the lightweight setup without an MCP server, just be consistent.

## What pages are NOT

- **Not Markdown.** Markdown is authoring input or operational logs only.
- **Not data blobs.** No JSON inside pages. No script tags. No embedded YAML.
- **Not fragments.** Always a full HTML5 document.
- **Not templates.** The page is the rendered form. A template's job is to produce a page, not to be one.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| Page invisible to search | Missing `robin:type` | Add `<meta name="robin:type" content="…">`. |
| Wikilink renders red | `data-broken="missing"` | Check the slug. Page might not exist. |
| Wikilink renders ambiguous | Multiple pages share the slug | Use path-disambiguated form: `data-wiki="folder/slug"`. |
| Task doesn't appear in `/check-tasks` | Used `robin:state` instead of `robin:status` | Tasks need `status`, not `state`. |
| Tags joined with comma | `<meta name="robin:tag" content="a,b">` | Use repeated tags: `<meta name="robin:tag" content="a">` and `<meta name="robin:tag" content="b">`. |

See also:

- [`frontmatter-reference.md`](./frontmatter-reference.md) — every meta tag with semantics.
- [`wikilinks.md`](./wikilinks.md) — wikilink resolution rules.
- [`memory-events.md`](./memory-events.md) — the memory event JSONL schema.
