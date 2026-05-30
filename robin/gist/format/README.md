# Format

The strict contract specifications. The format is locked at v0.2.

- [`page-format.md`](./page-format.md) — the page skeleton: required `<meta>` tags, body wrapper, block-level affordances, canonicalization rules.
- [`frontmatter-reference.md`](./frontmatter-reference.md) — every `<meta name="robin:*">` tag, with cardinality and semantics, organized by page type.
- [`wikilinks.md`](./wikilinks.md) — link syntax, resolution rules, aliases, what counts as broken.
- [`memory-events.md`](./memory-events.md) — the `brain/memory/events.jsonl` schema: event kinds, memory fields, tiers, status lifecycle.

These are reference documents. Skim once; consult when writing pages or building tools.

## What's stable

- **Required meta tags** (`version`, `slug`, `path`, `type`, `updated`).
- **Page skeleton** (`<head>` with metas, `<body>` containing exactly one `<article data-robin-doc>`).
- **Wikilink form** (`<a data-wiki="…" href="/p/…">`).
- **Memory event JSONL** structure.
- **Canonicalization** properties (sorted tags, alphabetized data-* attributes, idempotent).

## What may evolve

- **Type vocabulary** — new types can be added when entirely new categories emerge. Adding is safe.
- **Optional meta tags** — type-specific frontmatter fields may grow. Adding is safe.
- **State / status vocabularies** — values like `evolving`, `draft` may proliferate. Stay consistent in your repo.

## What you should not change

- The required-tag set. Tools depend on it.
- The wikilink syntax. Resolvers depend on it.
- The memory event JSONL contract. The append-only audit depends on it.
- Renaming existing meta tags. Use deprecation cycles if you ever need to.
