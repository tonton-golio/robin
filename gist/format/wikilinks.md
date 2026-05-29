# Wikilinks

Internal links between pages in `brain/` and `out/` use a stable form that resolves by slug. This document is the full reference.

## The syntax

```html
<a data-wiki="page-slug" href="/p/page-slug">link text</a>
```

- The `data-wiki` attribute is the **canonical** reference.
- The `href` is computed from `data-wiki` at save time.
- The text between the tags is the visible label.

## Resolution rules

When a wikilink is rendered or checked, the resolver looks up `data-wiki` in this order:

1. **Exact path match.** If `data-wiki` ends in `.html`, match it against `robin:path` exactly.
   - `data-wiki="brain/projects/site-rebuild/site-rebuild.html"` → only matches that path.

2. **Path-suffix match.** If `data-wiki` contains `/` but does not end in `.html`, match it as a suffix of `robin:path` (ignoring the `.html` extension).
   - `data-wiki="features/images"` → matches any page whose path ends with `features/images.html`.

3. **Bare slug match.** Otherwise, match `data-wiki` against `robin:slug` across the vault.
   - `data-wiki="site-rebuild"` → matches the page with `robin:slug="site-rebuild"`.

4. **Ambiguous.** If multiple pages match at the same priority level, the link is marked `data-broken="ambiguous"`.

5. **Missing.** If no page matches, the link is marked `data-broken="missing"` and renders in red (or with a visible "missing" affordance) in the viewer.

## Aliases

If you rename a page, incoming wikilinks break (until indexes are rebuilt). For controlled renames, maintain an alias map:

```json
// .robin/aliases.json
{
  "old-slug": "new-slug",
  "another-old-slug": "another-new-slug"
}
```

The resolver consults this map *before* slug match. Aliases are forever — old slugs continue to resolve.

## What renders broken

A wikilink renders as broken when:

- `data-wiki` references a page that doesn't exist.
- The slug is ambiguous (multiple matches).
- The page exists but has `robin:state="archived"` (renders with `data-archived="true"` and a struck-through style — still resolvable, but visually marked).

Broken links are not errors. They are **signals**. A red link to a page that doesn't exist is often a *future* page — a slot for knowledge you know you should write. `/lint-wiki` will surface broken links so you can decide whether to write the page or rephrase the reference.

## What never gets rewritten

- **Code blocks.** Wikilink rewriting does not recurse into `<pre>` or `<code>`. Text in code stays literal.
- **External URLs.** Use a normal `<a href="https://…">` for outside links. Never a `data-wiki`.
- **Anchor links within a page.** Use `<a href="#section-id">`. No `data-wiki`.

## Path-disambiguation in practice

Most slugs are unique enough that bare-slug form works:

```html
<a data-wiki="site-rebuild" href="/p/site-rebuild">site rebuild</a>
```

When two pages collide:

```html
<a data-wiki="projects/site-rebuild/features/hero" href="/p/projects/site-rebuild/features/hero">hero feature</a>
```

Or the path-suffix form:

```html
<a data-wiki="features/hero" href="/p/features/hero">hero feature</a>
```

The suffix form is shorter but only works when "features/hero" is unique across the vault.

## In source HTML you author by hand

If you author a page in Markdown that converts to HTML, the converter handles wikilinks:

```markdown
See the [[site-rebuild]] project.
```

becomes:

```html
<a data-wiki="site-rebuild" href="/p/site-rebuild">site-rebuild</a>
```

You can use a labeled form:

```markdown
See the [[site-rebuild|site rebuild]] project.
```

becomes:

```html
<a data-wiki="site-rebuild" href="/p/site-rebuild">site rebuild</a>
```

If you author HTML directly, just write the `<a data-wiki>` form.

## Backlinks

A page's incoming wikilinks are its backlinks. In the lightweight setup, you (or your viewer/MCP) compute backlinks by grepping the vault:

```bash
grep -r 'data-wiki="site-rebuild"' brain/
```

The MCP server (optional power-up) maintains a links table for instant backlink lookups.

## Common authoring patterns

### Linking to a person

```html
<a data-wiki="jamie-doe" href="/p/jamie-doe">Jamie</a>
```

### Linking to a decision

```html
<a data-wiki="2026-05-28-q3-priority-shift" href="/p/2026-05-28-q3-priority-shift">Q3 priority shift decision</a>
```

### Linking to a project feature

```html
<a data-wiki="projects/site-rebuild/features/hero" href="/p/projects/site-rebuild/features/hero">hero feature work</a>
```

### Linking to a hub

```html
<a data-wiki="agent-frameworks" href="/p/agent-frameworks">agent frameworks hub</a>
```

## Anti-patterns

- **Bare plain-text references to entities.** "Talk to Jamie" with no wikilink is invisible to backlinks. Wherever a page name appears, write `<a data-wiki="…">…</a>`.
- **Comma-separated wikilinks in a single anchor.** Each entity gets its own `<a>`.
- **Wikilinks to non-existent pages used as "to-do" placeholders forever.** A red link is a slot. Either fill it or rephrase.
- **Path-disambiguated form when slug-only works.** Use the simplest form that's unambiguous.

See also:

- [`page-format.md`](./page-format.md) — the page skeleton.
- [`frontmatter-reference.md`](./frontmatter-reference.md) — meta tag reference.
