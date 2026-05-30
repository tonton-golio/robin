# Retrieval

Where to look for knowledge. In what order.

## Default surfaces

Start here, in this order:

1. **`brain/_index.html`** — the master map. The first thing to read in a new session (after `CLAUDE.md` and `identity.md`).
2. **`brain/memory/events.jsonl`** — compact recall. Cheap to scan; high signal for preferences, corrections, source-of-truth notes.
3. **Direct page reads** by path: `brain/projects/<slug>/`, `brain/people/<bucket>/`, etc.
4. **`grep` / `rg`** scoped to `brain/`. Fast for keyword search.

Only leave `brain/` when:

- Following a `<meta name="robin:source" …>` link to an inbox source.
- Ingesting new material from `inbox/`.
- Inspecting a code repo for implementation details.
- {{USER_NAME}} explicitly asks for something outside the brain.

## Tool priority

In a powered-up setup with an MCP server:

1. `knowledge.search` — unified search across memory events and indexed pages. Use first for "where is X?" questions.
2. `memory.search` — when you only need a recall cue.
3. `page.search` — when you only need a page.
4. `page.list` — when you need to enumerate by type / state / folder.
5. `page.read` — when you have a specific page in mind.
6. `grep` / `rg` as fallback.

In a lightweight setup (no MCP):

1. `brain/_index.html` — start here.
2. `grep -r '<term>' brain/`.
3. Direct file reads.

## Search hygiene

For the brain to be searchable, two contracts hold:

- **Every entity mention is a wikilink.** Plain-text mentions are invisible to backlinks.
- **Every page carries `robin:type`.** Pages without it are invisible to structured queries.

When you find a page missing one of these, fix it. Search is only as good as the metadata.

## What surfaces fast

Memory events (`brain/memory/events.jsonl`) are *fast*. The file is small; lexical search is instant. Use memory events for high-frequency recall cues:

- "We use EUR."
- "The translation channel is `#proj-translations`, not `#translation`."
- "Stakeholder X prefers Loom."

Page reads are *slower but deeper*. Use pages for substance:

- A person's bio.
- A project's current state.
- A decision's rationale.

The right retrieval order is memory events first, then pages. The MCP's `knowledge.search` does this automatically.

## When to read a whole directory

Sometimes a question doesn't map to a specific page. Examples:

- "What are all the active projects?" → `ls brain/projects/` or `page.list folder=brain/projects type=project`.
- "Who are the stakeholders?" → list `brain/people/stakeholders/`.

Reading a directory is fine. It's the same cost as reading a list of titles in an `_index.html`.

## What not to do

- **Don't grep for entities without considering wikilinks.** A grep for "Jamie" hits prose mentions and missed-wikilink references. A grep for `data-wiki="jamie-doe"` is precise.
- **Don't crawl `inbox/` looking for facts.** Inbox is raw. If a fact you need isn't in the brain, ingest the source, then read the brain. Skipping the ingest leaves the brain stale.
- **Don't read `out/` for facts.** `out/` is artifacts. They're point-in-time, may be stale, and crafted for external audiences. The brain is the source of truth.

## Fallback: legacy tooling

Some users have an Obsidian setup, a Notion export, or a notes app they've migrated from. These are *legacy fallbacks*:

- Acceptable if the brain doesn't yet have the answer.
- The right response is to *ingest* the legacy source into `brain/` so the next query lands first-hop.

The brain should compound. Every retrieval miss is a signal to ingest something.
