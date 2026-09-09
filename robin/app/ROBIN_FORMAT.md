# ROBIN_FORMAT — v0.2 default, v0.3 staged opt-in

This document defines the canonical on-disk format for Robin's browser-readable
brain. It is the contract between the converter, indexer, editor, and MCP
server. v0.2 remains the producer default. v0.3 is accepted only through an
explicit, reviewed migration and adds immutable identity plus typed provenance;
it does not change the canonical article/body representation. The `robin:*`
HTML meta namespace is a legacy implementation detail and should not be used as
product language.

Robin copies the agentmemory architecture at the memory layer: durable pages are human-readable HTML, while recall memory is a structured engine store with tiers, lifecycle, search, and provenance. Do not model every memory as a page.

## File location and naming

- Canonical store: `<vault>` — Robin's home repo (this checkout; `ROBIN_VAULT` env var or repo root)
- Canonical brain pages: `<vault>/brain/**/*.html`
- Durable generated pages: `<vault>/out/**/*.html` only
- Archived rendered outputs: `<vault>/inbox/archived/outputs/**/*.html`
- Operational logs: `<vault>/logs/changelog.md`, `<vault>/logs/ingest-log.md`, and `<vault>/logs/repo-log.md`
- Structured recall memory: `<vault>/brain/memory/events.jsonl`
- Audio: `<vault>/inbox/meetings/audio/<ISO-timestamp>.webm`
- Edit history: `<vault>/inbox/robin/edits/<YYYY-MM>.jsonl` plus currently
  tracked prior-byte snapshots under `<vault>/.history/`; referenced snapshots
  are retained and only unreferenced snapshots are eligible for thinning
- Runtime sidecar: `<vault>/.robin/` (fully gitignored, but mixed durability:
  `index.db` is rebuildable, locks are ephemeral coordination, `aliases.json`
  may be operator-authored, and pending transaction receipts/delete tombstones
  are critical crash-recovery evidence)
- Alias overrides: `<vault>/.robin/aliases.json` (gitignored unless user opts in)

**Slug rules:**
- Slugs are kebab-case, lowercase, ASCII-only.
- The slug for a page equals the basename of its file (without `.html`).
- The unique key for a page is its **`robin:path`** (vault-relative), not its slug. Slugs need NOT be globally unique — e.g. every directory has an `_index` page, so `_index` is a reserved, intentionally-shared basename. The indexer keys `pages` on `path`; a non-unique slug does not block indexing.
- Resolution prefers a path match; a bare slug resolves only when it is unique. `page.create` warns (not 409) when a new bare slug collides with an existing one, so authors can prefer path-qualified links.

## File format

Every page is a complete `<!doctype html>` document. The format has three goals: indexable by a simple meta-scan, lossless to round-trip, and openable directly in a browser without the app.

### Skeleton

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{title}</title>
  <link rel="canonical" href="/p/{slug}">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="{slug}">
  <meta name="robin:path" content="{vault-relative-path}">
  <meta name="robin:type" content="{type}">
  <meta name="robin:state" content="{state}">
  <meta name="robin:updated" content="{ISO-8601 UTC}">
  <meta name="robin:summary" content="{summary}">
  <!-- additional scalar fields as needed -->
  <meta name="robin:owner" content="{owner}">
  <!-- arrays use repeated meta tags, one per value -->
  <meta name="robin:tag" content="risk">
  <meta name="robin:tag" content="register">
</head>
<body>
  <article data-robin-doc>
    <h1>{title}</h1>
    <!-- canonical body HTML — hand-edit or converter-emitted, no embedded JSON -->
  </article>
</body>
</html>
```

### `<head>` rules

| Rule | Why |
|---|---|
| One `<meta>` per scalar value. | Standards-compliant; trivial to parse. |
| Repeat `<meta name="robin:tag">` per array element. Never comma-join. | Avoids splitting tags like `"FR-CA"` on commas. |
| All datetimes are ISO-8601 UTC: `2026-05-28T00:00:00Z`. | One format, one parser. Naked YAML dates get `T00:00:00Z` appended at convert time. |
| The set of recognized `robin:*` meta keys is fixed (see §Meta vocabulary). Unknown keys are dropped at canonicalization — author them as body content instead. | The index parses meta tags exclusively; adding a new indexed field requires a spec bump. |
| Body HTML inside `<article data-robin-doc>` is the single source of truth for content; `<meta name="robin:*">` tags are the canonical metadata. There are no embedded JSON `<script>` blocks. | One artifact, readable in a browser and grep-friendly. |
| `<title>` is the rendered title (typically the first `<h1>` content). | Browser tab + search snippets. |

### `<body>` rules

| Rule | Why |
|---|---|
| Body root is a single `<article data-robin-doc>`. | Anchor for the renderer and CSS. |
| Body HTML is canonical. The converter emits it directly from markdown input via the frozen blocks-to-HTML emitter as an in-memory intermediate, but blocks are never persisted to disk. Hand-editing the body is fully supported. | Single source of truth, no shadow copy. |
| Semantic block hints use `data-block="{kind}"` attributes (`paragraph`, `heading`, `bulletList`, `taskList`, `task`, `codeBlock`, `quote`, `callout`, `image`, `hubChildren`). | Stable selectors for tests and CSS. |
| Wikilinks: `<a data-wiki="{slug}" href="/p/{slug}">{label}</a>`. `data-wiki` is canonical; `href` is rewritten from `data-wiki` at save time. | Render-time resolution. Renames are an index update only. |
| Callouts (Obsidian `> [!note]` syntax) become `<aside data-callout="{type}">…</aside>`. Foldable variants (`> [!note]-`) get `data-collapsed="true"`. | First-class callouts without coupling to a markdown plugin. |
| Task checkboxes: `<li data-block="task" data-checked="true|false">…</li>`. | Editor-friendly, query-friendly. |
| Code blocks: `<pre data-lang="{lang}"><code>…</code></pre>`. Wikilink transform must NOT recurse into `<code>`. | Avoid `[[` literals in code being mistakenly wikilinked. |
| Embedded images (`![[image.png]]`) become `<figure data-embed="image"><img src="{resolved-path}" alt=""></figure>`. | Round-trippable embed semantics. |
| Hub child listings are NOT baked into HTML. A hub uses `<ul data-block="hubChildren" data-query="{query}"></ul>` and the renderer fills it at view time from the index. | Renames don't cascade. |

### Wikilink resolution

- Source of truth: `data-wiki="{slug}"`.
- Resolver: SQLite `wikilinks` table populated by the indexer.
- Resolution order:
  1. Ref ending in `.html` → exact vault-relative path.
  2. Path-like ref (contains `/`, e.g. `features/images` or `projects/_index`) → exact or **path-suffix** match against a page's `robin:path` (matches `brain/projects/beacon/features/images.html`). This is how post-restructure links resolve even though the stored basename slug differs.
  3. Bare slug → unique `robin:slug` match across the vault.
  4. Multiple matches → `data-broken="ambiguous"`, listed in lint panel.
  5. No match → `data-broken="missing"`, rendered red.
- `archive/` pages resolve normally but render with `data-archived="true"` (struck-through styling). They are NOT excluded — current vault relies on archive resolution.
- `<vault>/.robin/aliases.json` provides manual overrides: `{"old-slug": "new-slug"}`. Loaded at indexer start.

### Canonicalization

Every save passes through `canonicalize(html)`:

1. **Parse** with `parse5` into a HAST tree.
2. **`<head>` normalization:**
   - Sort `<meta name="robin:*">` tags by name, then by content (lexical).
   - For multi-value tags (e.g., `robin:tag`), sort values lexically.
3. **Wikilink href rewrite:** for every `<a data-wiki>`, look up slug → path; rewrite `href`. Set `data-broken` if unresolved.
4. **Attribute order:** alphabetize all `data-*` attributes for stable diffs.
5. **Whitespace:** prettier with `--parser html --html-whitespace-sensitivity strict`, but with `<pre>` content preserved verbatim.

A pre-commit hook (specified in §Pre-commit hook) is intended to run `canonicalize` on any staged `.html` under `brain/` or `out/`. Tests assert idempotence: `canonicalize(canonicalize(x)) === canonicalize(x)`.

### Memory That Stays Structured

`brain/memory/events.jsonl` is Robin's agentmemory-style recall ledger, not a page. It is append-only and rebuilds projected memories, search indexes, and UI views.

The memory model has four tiers:

- `working`: captured observations and short-lived facts
- `episodic`: compressed session or meeting summaries
- `semantic`: extracted facts, preferences, corrections, decisions, and relationships
- `procedural`: reusable workflows, rules, and decision patterns

Each promoted memory must include status, confidence, tier, scope, sources, links, timestamps, and a deterministic fingerprint. Memories may be superseded, rejected, archived, or strengthened by repeated sightings. Search should return a small cited context set, not the full memory store.

### Markdown that stays markdown

Markdown is allowed only for operational/source material. It is not a durable Robin page format.

The following files are operational logs, not brain pages. They are append-only, grep-friendly, and read by automation. They remain `.md` unless replaced by a structured event stream:

- `logs/changelog.md`
- `logs/ingest-log.md`
- `logs/repo-log.md`
- Any file whose first frontmatter field is `type: log` (reserved for future log files)

The MCP `log.append` tool wraps an atomic `writeFile(tmp) + rename` to preserve concurrency safety. The web UI renders these in a dedicated "Logs" tab via `marked()` at view-time; they are NOT included in FTS by default.

### Inbox source files

`<vault>/inbox/` stores source-native captures. Meeting transcripts (`inbox/meetings/*.md`), interviews (`inbox/interviews/*.md`), and miscellaneous sources may stay markdown while they are active source material. After ingestion, durable Robin surfaces are HTML.

`<vault>/inbox/archived/outputs/` stores historical rendered outputs. If a file has both `.md` and `.html` siblings there, keep the `.html` and remove the `.md` sibling. This avoids two competing versions of the same archived output.

## Meta vocabulary

| Meta key | Cardinality | Type | Required | Notes |
|---|---|---|---|---|
| `robin:version` | 1 | string | yes | `0.2` (producer default) or `0.3` (staged opt-in). |
| `robin:id` | 0..1 | lowercase UUID | v0.3 only | Required exactly once in v0.3 and prohibited in v0.2. Immutable after migration; this is the stable v0.3 page identity. |
| `robin:slug` | 1 | string | yes | Kebab-case basename. Need not be globally unique; `path` is the unique vault locator and v0.3 adds stable `robin:id`. |
| `robin:path` | 1 | string | yes | Vault-relative locator, e.g. `brain/risk-register.html`. It is the operational identity in v0.2; v0.3 uses `robin:id` as stable identity. |
| `robin:type` | 1 | enum | yes | The executable vocabulary is `annotation`, `artifact`, `brief`, `candidate`, `commitment`, `compile-receipt`, `decision`, `feature`, `hub`, `index`, `intervention`, `interview`, `knowledge`, `meeting`, `note`, `pattern`, `person`, `playbook`, `project`, `presentation`, `reflection`, `reflection-questions`, `remsleep`, `repo`, `report`, `reference`, `skill`, `standard`, `storyboard`, `task`, `template`, `tool`, `understanding`, and `work-log`. |
| `robin:state` | 0..1 | string | no | Type-specific: `in-progress`, `done`, `stable`, `evolving`, `needs-review`, `archived`, etc. |
| `robin:updated` | 1 | ISO-8601 UTC | yes | Set automatically on every save. |
| `robin:created` | 0..1 | ISO-8601 UTC | no | Set once on create. |
| `robin:summary` | 0..1 | string | recommended | One-line summary. Surfaced in search results. |
| `robin:owner` | 0..1 | string | no | Person responsible. |
| `robin:priority` | 0..1 | enum | no | `p0` \| `p1` \| `p2` \| `p3`. Higher number means lower priority. Tasks only. |
| `robin:due` | 0..1 | ISO-8601 date | no | Tasks only. |
| `robin:role` | 0..1 | string | no | People only. |
| `robin:relationship` | 0..1 | string | no | Lowercase kebab classification such as `direct-report`, `stakeholder`, `strategic-partner`, or `hiring-partner`. People only. |
| `robin:started` | 0..1 | ISO-8601 date | no | People only. |
| `robin:date` | 0..1 | ISO-8601 date | no | Meetings, briefs, reports. |
| `robin:attendee` | 0..* | string | no | Meetings. Repeated. |
| `robin:duration` | 0..1 | string | no | Meetings. E.g. `"45 min"`. |
| `robin:source` | 0..* | string | v0.2 only | Legacy provenance. Prohibited in v0.3. |
| `robin:source-kind` | 0..* | enum | v0.3 only | Optional typed provenance. Each occurrence is paired by order with one `robin:source-ref`; allowed kinds are `annotation`, `audio`, `conversation`, `document`, `email`, `import`, `manual`, `meeting`, `other`, `slack`, `upload`, and `web`. |
| `robin:source-ref` | 0..* | string | v0.3 only | Non-empty, unique provenance reference paired by order with `robin:source-kind`. Both arrays must have equal cardinality. |
| `robin:tag` | 0..* | string | no | Repeated, lexically sorted at canonicalization. |
| `robin:tier` | 0..1 | enum | no | Override automatic tier assignment. `working` \| `episodic` \| `semantic` \| `procedural`. |

Unknown frontmatter keys are dropped at canonicalization — author them as body
content instead. The index parses meta tags exclusively, so adding a new
indexed field requires a spec bump. A v0.3 write is rejected if it removes or
changes `robin:id`, downgrades the version, restores legacy `robin:source`, or
breaks the ordered provenance pairs.

## YAML → meta mapping

The converter applies the following normalizations:

| YAML form | Meta output | Notes |
|---|---|---|
| `tags: [risk, register]` | `<meta name="robin:tag" content="risk">`, `<meta name="robin:tag" content="register">` | |
| `tags: risk, register` (Obsidian comma-string) | Same as above. | Pre-process: split on `,`, trim, treat as array. |
| `updated: 2026-05-28` (naked date) | `content="2026-05-28T00:00:00Z"` | Append `T00:00:00Z`. |
| `updated: 2026-05-28T10:00:00+02:00` | `content="2026-05-28T08:00:00Z"` | Normalize to UTC. |
| `attendees: [Alex, Sam]` | `<meta name="robin:attendee" content="Alex">`, … | Field rename: `attendees` → `attendee` (singular for array conformance). |
| `source: inbox/meetings/foo.md` | `<meta name="robin:source" content="inbox/meetings/foo.md">` | Single value still emitted as one `<meta>`. |
| `priority: p2` | `<meta name="robin:priority" content="p2">` | |

The mapping is encoded in `packages/converter/src/meta.ts` as a `FieldMapping[]` table.

## In-app editor (future)

The web app is read-only today; pages are authored via the agent / files / MCP. An
in-app rich-text editor remains possible but is intentionally **not** wired in. Blocks
are **not** stored on disk in v0.2 or v0.3 — body HTML is the only persisted content.

- The converter still uses the frozen, vendored blocks-to-HTML emitter (`packages/converter/src/blocks-to-html.ts`) as an in-memory intermediate when transforming markdown input to canonical HTML. The block tree never reaches the file.
- If an editor is wired in later: an html→blocks parse runs at editor open time, blocks→html serialization runs at save time. Block `id` fields stay session-local and are regenerated each load. The file format does not change.

## Pre-commit hook

Pre-commit hooks are managed by **lefthook** (`robin/app/lefthook.yml`). The `robin/app` hook currently runs biome + the converter golden tests on `robin/app/` source.

A vault-level canonicalization hook — applying `canonicalize` to every staged `.html` under `brain/` or `out/` and re-staging (failing the commit with a diff if a file was not canonical) — is **specified but not yet installed**. When added it should invoke the converter CLI (`node packages/converter/dist/cli.js`, `--staged` mode) via lefthook, not husky.

## Round-trip golden test (Phase 1.5 gate)

`packages/converter/test/golden/` contains 10 representative `.md` files plus their expected `.html` output. The test suite:

1. Converts each `.md` to `.html`. Asserts byte-equality to the checked-in `.html`.
2. Re-canonicalizes the `.html` once more. Asserts idempotence — the output is unchanged.

There is no longer a blocks-JSON round-trip step: blocks are not persisted, so the HTML itself is the only artifact under test. This is a CI gate. Any converter change re-runs these. Any failure blocks the converter from being modified without explicit golden updates.

## Versioning

The converter emits v0.2 by default. v0.3 is a staged opt-in for an explicitly
reviewed page set; no normal writer or startup path bulk-migrates a vault.

Build the converter, run it from the vault root, inspect `--dry-run`, back up the
selected files independently, apply the migration, then use `--check` to prove
the selected files have converged:

```sh
npm --prefix robin/app run build --workspace=@robin/converter
npm --prefix robin/app run build --workspace=@robin/vault-io
node robin/app/packages/converter/dist/cli.js migrate --to v0.3 base/brain/example.html --vault base --dry-run
node robin/scripts/migrate-page.mjs --vault base --to v0.3 base/brain/example.html --dry-run
node robin/scripts/migrate-page.mjs --vault base --to v0.3 base/brain/example.html --write
node robin/scripts/migrate-page.mjs --vault base --to v0.3 base/brain/example.html --check
```

Normal durable writes enforce the post-migration boundary: they refuse a v0.3
downgrade or `robin:id` replacement. A future producer-default bump still
requires updating converter defaults, an explicit migration path, contract and
golden tests, this changelog, and restore/recovery validation.

Migration accepts only an unambiguous Robin document: exactly one
`<article data-robin-doc>`, exactly one non-empty title in the real document
head, and exactly one non-empty slug/type/updated value. Generic output HTML is rejected. Directory and glob
runs are strict and should be used only to inventory candidates; writes should
use an explicit reviewed file set. The CLI reads the executable page roots from
`robin/schemas/v1/contract.json` and refuses v0.3 migration outside those roots;
capture/inbox migration requires a future contract change rather than a bypass.
Directory/glob migration is planning-only. The single-page writer validates the
transformed contract before taking the vault lock and uses compare-and-swap,
history, an audit event, and a crash-recovery receipt for the write.
It also refuses a stale built runtime and treats any canonical article-byte
change as a failed migration invariant.
When v0.3 needs a new random identity, dry-run JSON reports
`preview_reproducible=false`; the preview hash proves that candidate bytes
validated but is not a promise to reuse the ephemeral UUID during apply.
The same plan reports proposed identity/provenance metadata and matching
before/after article hashes.

### CHANGELOG

- **v0.3 — staged opt-in, 2026-07-25.** Added one immutable lowercase UUID
  `robin:id`. Replaced legacy repeated `robin:source` with optional, ordered
  `robin:source-kind`/`robin:source-ref` pairs of equal cardinality. The article
  body remains canonical HTML. v0.2 remains the producer default.
- **v0.2 — 2026-05-28.** Dropped `<script id="robin:blocks">` and `<script id="robin:frontmatter">` from the on-disk format. Body HTML inside `<article data-robin-doc>` is the sole canonical content store; `<meta name="robin:*">` tags remain the canonical metadata. The frozen blocks-to-HTML emitter still exists in `packages/converter` as an in-memory intermediate during markdown→HTML conversion, but blocks are never persisted. Unknown frontmatter keys are dropped (previously round-tripped via `#robin:frontmatter`). Round-trip golden tests assert HTML idempotence rather than blocks-JSON byte equality. Migration script: `packages/converter/migrations/v0.1-to-v0.2.ts`.
- **v0.1.** Initial locked format. Embedded `<script id="robin:frontmatter">` (lossless YAML mirror) and `<script id="robin:blocks">` (BlockNote source of truth) in `<head>`; body HTML regenerated from blocks on every save.

## Out of scope (deferred to future versions)

- Embedded queries in body (`<x-query>` element) — Phase 5+ feature.
- Multi-vault federation — single-user, single-vault.
- Encryption.
- Non-HTML attachments beyond images.
