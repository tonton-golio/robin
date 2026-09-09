# Compiled Memory Architecture

Status: working design plus first implementation slice.

This document defines the target Robin memory system: a human-editable, agent-maintained, source-backed wiki whose search and graph affordances improve over time. It is inspired by the LLM Wiki pattern and by local-first second-brain systems, but it keeps Robin's existing durable contract: canonical HTML pages, append-only JSONL event streams, and rebuildable SQLite projections.

## Product North Star

Robin memory should compound.

When a meeting, annotation, manual edit, source document, task update, or agent answer creates durable knowledge, Robin should not leave that knowledge as chat history or raw notes. It should compile it into:

- canonical HTML pages that a human can read and edit in the Robin app;
- memory events for compact recall and lifecycle tracking;
- graph edges that make related pages easy to follow;
- link candidates and maintenance queues that keep the wiki navigable;
- provenance receipts that explain exactly where a claim came from.

The human remains editor-in-chief. Robin proposes links, page changes, promotions, and resolutions. The human can accept, reject, rewrite, or ignore them in the app.

## Existing Assets To Preserve

Robin already has strong foundations:

- Canonical content is `brain/**/*.html` and selected `out/**/*.html`.
- Page identity is vault-relative path; slugs can collide.
- Page writes through web/MCP mostly use `@robin/vault-io`, which snapshots prior bytes and appends edit events.
- Compact memory lives in `brain/memory/events.jsonl` and is projected by `@robin/memory`.
- Search uses `@robin/indexer`: SQLite pages, FTS5, optional vectors, wikilinks, and graph expansion.
- Rich editing infrastructure exists as block load/save APIs and an HTML-to-blocks parser; the normal page reader is still read-only.

The architecture below extends those pieces instead of replacing them.

## Layer Model

### 1. Raw Sources

Raw sources are immutable or append-only:

- `inbox/meetings/*.md`
- `inbox/robin/annotations/*.jsonl`
- `inbox/robin/edits/*.jsonl`
- uploaded files and clips
- external documents copied into the vault

Raw sources are never the user-facing memory layer. They are evidence.

Required metadata for source artifacts:

- stable source id;
- source kind;
- capture timestamp;
- content hash;
- origin and tool when applicable;
- optional extracted text spans or quote anchors.

### 2. Canonical Wiki Pages

Canonical durable knowledge remains HTML pages.

Pages are where synthesis lives:

- projects, people, decisions, patterns, standards, playbooks, tasks;
- source summaries;
- synthesis pages created from queries;
- maintenance pages and indexes.

Pages must be human-editable in Robin's rich editor when they round-trip through the block model. Pages with raw HTML stay read-only until an editor schema supports them.

### 3. Memory Event Ledger

`brain/memory/events.jsonl` remains compact recall, not a replacement for pages.

Memory events should capture durable facts that need quick retrieval:

- user preferences;
- corrections;
- decisions;
- strategic commitments;
- recurring procedures;
- high-signal project/person facts.

The memory ledger should use the same source receipts as page edits, so a memory can point to the edit/source/page that produced it.

### 4. Compiled Graph Projection

The compiled graph is rebuildable SQLite state.

It should include:

- page nodes;
- memory nodes;
- source nodes;
- resolved edges;
- unresolved or ambiguous raw links;
- candidate links;
- claim/source edges;
- supersession edges;
- page revision refs.

The projection is allowed to be radical because it is derived. If it is wrong, delete it and rebuild from pages, JSONL, and source artifacts.

## First Implementation Slice

The first shipped slice is page relationship intelligence.

`@robin/indexer` now exposes `getPageConnections(db, pagePath, opts)`:

- resolves a page by exact path or slug fallback;
- returns outbound wikilinks;
- returns backlinks;
- returns deterministic two-hop trails;
- returns unlinked mention suggestions based on page titles/slug phrases.

The web app exposes this through:

- `GET /api/connections?path=brain/foo.html`;
- a page-level Connections rail on brain pages.

This is read-only. It gives the human visibility before any automatic linker mutates pages.

## Target Compiled Tables

Current schema can support the first slice, but the target projection should add path-resolved graph tables.

### `nodes`

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- page | memory | source | claim
  path TEXT,
  slug TEXT,
  title TEXT,
  type TEXT,
  status TEXT,
  content_hash TEXT,
  updated_at TEXT,
  indexed_at TEXT,
  payload_json TEXT
);
```

### `resolved_edges`

```sql
CREATE TABLE resolved_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT,
  raw_target TEXT,
  kind TEXT NOT NULL,              -- wikilink | mentions | source | supersedes | supports | contradicts
  status TEXT NOT NULL,            -- resolved | unresolved | ambiguous | candidate | rejected
  confidence REAL NOT NULL,
  evidence_json TEXT,
  source_hash TEXT,
  indexed_at TEXT
);
```

Why this matters: current links store `from_path` but still target `to_slug`. Since slugs collide, a compiled edge must preserve both raw target and resolved path. Ambiguity should be surfaced, not silently collapsed.

### `claims`

```sql
CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  subject_node_id TEXT,
  predicate TEXT NOT NULL,
  object_text TEXT NOT NULL,
  status TEXT NOT NULL,            -- active | tentative | superseded | rejected
  confidence TEXT NOT NULL,
  source_node_id TEXT,
  source_quote TEXT,
  source_anchor_json TEXT,
  produced_by_event_id TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

Claims are optional at first. They become important when Robin starts detecting contradictions and supersession.

### `link_candidates`

```sql
CREATE TABLE link_candidates (
  id TEXT PRIMARY KEY,
  page_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  matched_text TEXT NOT NULL,
  reason TEXT NOT NULL,
  score REAL NOT NULL,
  status TEXT NOT NULL,            -- open | accepted | rejected | stale
  evidence_json TEXT,
  page_hash TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
```

Candidates must be hash-bound. If the page changes, stale candidates can be hidden or regenerated.

## Memory Build-Up Flow

### Capture

Every capture writes a source artifact and a receipt.

Examples:

- meeting transcript saved;
- browser annotation stored;
- page edited;
- task changed;
- source file imported;
- user asks a query and chooses to save the answer.

### Triage

Robin classifies the capture:

- no durable value;
- task/action item;
- page update;
- new page;
- memory event;
- source summary;
- contradiction or supersession;
- needs human review.

Triage should be conservative. It is better to create a candidate than to silently rewrite canonical knowledge.

### Compile

Compilation produces proposed operations:

- update existing page section;
- create page;
- add wikilink;
- add memory event;
- resolve/supersede memory;
- add backlink/index entry;
- add task;
- append changelog/work-log entry.

Every operation carries source receipts.

### Review

The Robin app should show a review queue:

- source excerpt;
- proposed page/memory/link changes;
- impacted pages;
- confidence and reason;
- accept/rewrite/reject controls.

Accepted changes flow through `writeWithHistory` or the memory event writer, never through direct file mutation.

### Maintain

Maintenance is a recurring compiler pass:

- broken links;
- ambiguous links;
- orphan pages;
- pages with strong unlinked mentions;
- stale pages that are accessed often;
- tentative memories that need resolution;
- rejected/superseded memories that should be hidden from default recall;
- pages whose source receipts point to missing files;
- duplicate or near-duplicate pages/memories;
- contradictions between claims.

## Smart Linking Policy

Robin should make linking easy, but it should not over-link.

Good candidates:

- exact title mention;
- exact person/project/decision title mention;
- slug phrase mention;
- repeated co-mentions across sources;
- semantic nearest neighbor plus lexical evidence;
- page linked by a linked page in a relevant two-hop trail.

Bad candidates:

- generic titles like "Home", "Index", "Tasks", "Overview";
- archive pages unless explicitly requested;
- ambiguous slug targets without human choice;
- single short words;
- pages already linked from the source page;
- candidates generated from old page hashes.

Accepting a candidate should use the existing rich editor/block model or MCP `link.add`, then log the edit.

## Human Editing Concept

The Robin app should treat editing as the primary memory input, not an afterthought.

Desired editor affordances:

- page title and summary fields;
- block editor for canonical content;
- wikilink autocomplete backed by the compiled graph;
- inline link suggestions for unlinked mentions;
- source/provenance sidebar for selected paragraph;
- backlinks and trails sidebar;
- edit history and one-click restore;
- "promote this paragraph to memory" command;
- "save this answer as page/synthesis" command;
- "this is wrong" command that creates correction memory and candidate page edits.

Editing produces memory because edits are logged. The edit stream can be ingested after the fact to extract durable facts, but the canonical page change itself is already memory.

## Retrieval Strategy

Query should run over multiple layers:

1. Exact path/slug/title lookup.
2. Active memory events.
3. FTS page search.
4. Vector page search.
5. Graph expansion from top hits.
6. Candidate trails from current working context.
7. Source receipts when provenance detail is needed.

Results should be fused into one ranked set eventually. Today `knowledge.search` returns memory and page blocks separately; that should become a unified ranker with a clear result kind and citation model.

## Provenance Rules

Every durable synthesized fact should be traceable to at least one of:

- raw source path and content hash;
- source quote or text anchor;
- edit event id;
- memory event id;
- page path plus revision hash;
- human manual source marker.

Generated summaries may be useful, but they should not become untraceable authority.

## Maintenance And Lint Rules

Add these checks over time:

- Memory JSONL schema drift: malformed lines, unknown enums, invalid source shape.
- Memory projection health: tentative, rejected, superseded, duplicate fingerprints.
- Link health: unresolved, ambiguous, orphan, archive leakage.
- Candidate health: high-score mentions not accepted/rejected after N days.
- Provenance health: pages/memories without source receipts where expected.
- Index freshness: page hash in index differs from disk hash.
- Event receipt coverage: page writes, moves, deletes, memory writes, annotation resolves, and source ingests all have audit events.

The existing `doctor.sh`, web maintenance page, MCP `vault.lint`, and indexer should converge on the same underlying graph/resolution logic.

## Known Risks

- Slug-based target resolution can pick the wrong page when slugs collide.
- Memory schemas are duplicated across package code, MCP schemas, web validation, and docs.
- Current live memory data includes types outside the accepted enum.
- Memory saves are serialized only within one process.
- Web writes currently do not incrementally update the index; resync/watch needs to become reliable.
- Direct agent file edits can bypass history unless routed through MCP/page APIs.
- Over-eager link insertion can make pages noisy.

## Phased Roadmap

### Phase 1: Read-Only Relationship Intelligence

Done in this slice:

- indexer relationship API;
- connection API route;
- page connections rail;
- focused relationship tests.

### Phase 2: Candidate Review Queue

- Persist hash-bound `link_candidates`.
- Add accept/reject controls.
- Route accepted links through existing page write/link tooling.
- Show stale candidates after page edits.

### Phase 3: Shared Memory Schema

- Centralize memory enum/source validation.
- Decide whether `strategic` is a first-class memory type.
- Add schema drift checks to maintenance/doctor.
- Reuse `loadMemoryProjection` in maintenance instead of manual partial replay.

### Phase 4: Unified Graph Projection

- Add path-resolved edges.
- Add memory/source nodes.
- Add unresolved/ambiguous edge status.
- Move web graph, maintenance, MCP link tools, and search expansion onto the same projection.

### Phase 5: Editor Integration

- Mount the rich editor on normal brain pages.
- Add wikilink autocomplete and inline link suggestions.
- Add provenance sidebars.
- Add promote-to-memory and save-answer-as-page flows.

### Phase 6: Ingest Receipts

- Normalize source-to-page/memory/task/log receipts.
- Add edit-stream ingestion for durable facts.
- Add contradiction/supersession review.

### Phase 7: Unified Retrieval

- Embed memory records.
- Fuse page, memory, source, and graph hits in one ranker.
- Return citations and graph trails with every answer.

## Design Principle

Keep the writeable human surface simple and inspectable. Put intelligence in rebuildable projections and review queues. Robin should be able to get smarter every day without making the canonical brain harder to trust.
