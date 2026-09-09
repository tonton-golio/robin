# Edit-anywhere · Logged · Back-steppable · Ingestible — design

> **Status:** Durable write/history/lifecycle substrate implemented 2026-07-25. The inline editor and automated edit-ingest product work described later remain roadmap items.
> **Scope:** The Robin app (`robin/app`) — framework-side, shareable. Does **not** touch the tasks/calendar features (owned separately).
> **Companion specs:** [`ROBIN_FORMAT.md`](../ROBIN_FORMAT.md) (file format contract), `README.md`.

## 1. What we're building

Four product requirements, verbatim:

1. **Edit anywhere** — edit any page/region inline, in place.
2. **Edits are logged**, allowing **back-step** (version history + undo/revert).
3. Because edits are logged, show a **list of edits**.
4. It must be possible to **ingest** the edit log (feed edits into Robin's learn → brain/memory pipeline).

### Decisions taken

| # | Decision | Choice | Consequence |
|---|---|---|---|
| Save model | How edits commit | **Debounced autosave while typing** | Maximum convenience; requires the history backstop to land *first* (see §3, Phase 6) so a bad autosave is never irreversible. |
| Ingest | What "ingest an edit" does | **Extract durable facts → memory; skip trivia** | The drain classifies edits, promotes real facts via `memory_save`, auto-skips typo/canonicalize-churn. |
| Edit scope | How much is editable | **Everything (full WYSIWYG)** | Forces a schema-constrained editor + a real `htmlToBlocks` inverse parser; raw contentEditable is rejected as the durable editor. |
| Versioning | Back-step substrate + Git posture | **`base/.history/` snapshots + immutable edit ledger** | Referenced snapshots provide fine-grained back-step. Git records reviewed repository versions; it is not the recovery protocol or a backup. |
| Editor stack | (bake-off, §6) | **Lexical** (37/50) over TipTap (34) over raw contentEditable (26) | Best autosave/undo-coalescing primitives; `checked: boolean\|null` maps with no fork. |

## 2. Current state (verified against the code, 2026-07-25)

- **There is no inline editor.** The reader (`PageView`, `app/[...path]/page.tsx`) is read-only. The `savePage` server action exists but has **zero callers**; the only thing that writes a page body today is the `/new` creation form.
- **Web and MCP page mutations now share one durable substrate.** `@robin/vault-io` serializes competing writers with cross-process locks, uses optimistic content hashes, snapshots prior bytes, persists a transaction receipt before exposing canonical bytes, appends one immutable edit event, and leaves a recoverable receipt if the final audit append fails.
- **Moves and deletes are first-class lifecycle mutations.** They use the same locks, snapshots, receipts, containment checks, and audit stream as writes; they never silently overwrite a destination.
- **Index freshness is incremental and lazy.** The web process creates the
  indexer on first actual index use, performs the initial scan, then starts the
  filesystem watcher. Successful web/MCP writes also refresh changed paths
  directly. A failed derived-index refresh is reported after commit without
  turning a durable write into a false failure.
- **Git is not the per-edit recovery substrate or a backup.** `.history/`, edit JSONL, and transaction receipts provide local recovery evidence; an independent, restore-tested backup covers disaster recovery.
- **Pages remain canonical HTML.** v0.2 is the producer default. Staged v0.3 adds an immutable UUID and paired typed provenance without changing the article/body representation.
- **The append-log + list + ingest-candidate pattern already exists** in the
  **annotations** system (`inbox/.../annotations/*.jsonl`,
  `collapseAnnotationEvents` in `lib/annotations.ts`, the `/comments` page, the
  `learn` candidate flag, and month-bucketed append). Edits borrow that product
  pattern but use a separate immutable-event reader; they do not reuse
  annotation collapse semantics.
- **Three mutation origins exist:** the web UI (server action / `/api/page/save`), MCP `page.write` (+ `page.write_many`, `page.create`, `page.move`, `page.delete`), and direct agent `Edit`/`Write` to `.html` files. The first two are in-process and catchable; the third is a separate process.

## 3. Architecture

```
            ┌─ Lexical inline editor ─┐
            │  agent Edit/Write       │ (best-effort, caught at remsleep diff)
ALL writes ─┼─ MCP page.write/* ──────┼─→ writeWithHistory()  ──→ atomic tmp+rename to brain/*.html
            └─ /new, /api/page/save   │        │
                                      │        ├─→ snapshot PRIOR bytes → base/.history/<path>/<ts>__<hash>.html
                                      │        └─→ append event        → inbox/robin/edits/<YYYY-MM>.jsonl
                                      ▼
        /edits list  ◀── immutable-event reader ─────┘   (revert = whole-file restore with CAS)
                                      │
                  remsleep ingest drain ─→ memory_save(source.kind='edit') + edit.ingested
                                      │
                  independent backup ───→ separately controlled, restore-tested copy
```

**Source-of-truth rule:** the page HTML on disk is the source of truth for *content*; `base/.history/` + the `edits` stream are the source of truth for *history*. `RobinBlock[]` is the in-memory contract on both ends of the editor — load produces it (`htmlToBlocks`), save consumes it (`blocksToBodyHtml` via `canonicalizeHtml`). The editor stack never serializes to disk directly.

### New on-disk artifacts

| Path | Role | Tracked? | Indexed? |
|---|---|---|---|
| `robin/app/packages/vault-io/` | the one shared `writeWithHistory()` write choke point | git | n/a |
| `robin/app/packages/converter/src/html-to-blocks.ts` | the missing inverse parser (HTML → `RobinBlock[]`) | git | n/a |
| `base/.history/<vault-path>/<ISO-ts>__<short-hash>.html` | prior-bytes snapshots (back-step substrate) | git, **sibling of `.robin`** (not inside it) | No — `scan.ts` globs only `brain/`+`out/` |
| `inbox/robin/edits/<YYYY-MM>.jsonl` | append-only edit-event stream | git | No |
| `base/.robin/transactions/<uuid>.json` plus delete tombstone | short-lived crash-recovery proof | ignored, but **not disposable while pending** | No |

`base/.history/` is currently git-**tracked** and invisible to the indexer by
construction. `pruneHistory` never deletes a snapshot referenced by a durable
edit event or a pending receipt. It thins only unreferenced snapshots, per page
path: keep all through 30 days, the newest per calendar day from day 31 through
day 90, and the newest per epoch week thereafter. There is no implemented
compression, maximum age, or total-size cap. Tracking does not make snapshots a
backup.

`.robin/` has mixed recoverability. The index is rebuildable and locks are
ephemeral coordination state, while transaction receipts and delete tombstones
are essential evidence after a crash. Never delete the directory wholesale;
inspect and recover pending mutations first.

### Edit-event schema (`inbox/robin/edits/<YYYY-MM>.jsonl`)

Append-only and month-bucketed from the event timestamp. `lib/edit-store.ts`
reads immutable edit events directly; it does not collapse same-ID annotation
state transitions.

```jsonc
{
  "id": "<uuid>",                       // unique mutation/event id
  "event": "edit.saved",                // "edit.created" | "edit.saved" | "edit.deleted" | "edit.reverted"
  "page_path": "brain/people/foo.html", // vault-relative
  "ts": "2026-06-03T10:14:02Z",
  "origin": "web",                      // | "mcp" | "agent"
  "actor": "human",                     // | "robin" | "claude-code"
  "tool": "page.write",                 // present when origin=mcp
  "before_hash": "sha256:…",            // prior content hash; null for edit.created
  "after_hash": "sha256:…",             // null for edit.deleted
  "snapshot": ".history/brain/people/foo.html/2026-06-03T10-14-02Z__a1b2c3.html",
  "summary": "tightened the role paragraph; corrected start date",
  "anchor": { "block_path": [3], "text_quote": { "exact": "…", "prefix": "…", "suffix": "…" } },
  "ingest": { "candidate": true, "category": "correction" }, // LearnCategory enum
  "transaction_id": "<same uuid>"       // correlates a durable mutation receipt
}
```

## 4. The write choke point — `writeWithHistory()`

A new package `robin/app/packages/vault-io` exporting one function that **both** writers route through:

- `apps/web/lib/write-page.ts` (web/UI + `/api/page/save`)
- `packages/mcp-server/src/html-utils.ts` (MCP `page.write` and friends)

```ts
writeWithHistory({ vaultRelativePath, html, origin, actor, tool?, anchor?, summary? }): Promise<WriteResult>
```

Behaviour, in order:
1. Prove the target is contained by the real vault root (including existing symlink targets).
2. Take a cross-process path lock and read prior bytes; enforce `expectedHash` when supplied.
3. **No-op when hashes match** — no mtime churn, duplicate history, or re-index.
4. Snapshot prior canonical bytes and durably persist a mutation receipt.
5. Atomically replace canonical bytes via unique temp file + rename, then fsync the file and parent directory.
6. Append one immutable `edit.*` event with duplicate-id suppression.
7. Remove the receipt only after the event is durable; refresh the changed index path after commit.

**Consistency/recovery contract:** if canonical bytes become visible but the audit append fails, the durable receipt remains and Doctor fails closed. Stop writers and preserve a vault copy before recovery. Build `@robin/vault-io`, run `robin-vault-recover --vault <vault> --json` to inspect, and use `--repair` only after reviewing the proof. Repair only appends a missing event (or clears an already-recorded receipt) when canonical bytes and recovery evidence prove the mutation. It never invents content or guesses through `invalid`/`incomplete` state; preserve those artifacts for manual reconciliation, then rerun Doctor.

**MCP origin tagging:** wrap the single tool dispatch point (`packages/mcp-server/src/server.ts:226`) to tag `page.write`/`page.write_many`/`page.create`/`page.move`/`page.delete`/`link.add`/`task.*` as mutating and stamp `origin='mcp'` + tool. This also closes two blind spots: `page.move` must **relocate the `.history/<path>` dir** (else chains orphan on rename) and `page.delete` must emit a delete event.

**Direct agent file edits** (`Edit`/`Write` on `.html`) are a separate process with no in-process hook — caught only by the remsleep commit diff (best-effort). Governance nudges toward MCP `page.write`. Documented limitation.

## 5. The `/edits` list + back-step

A new route cloning `/comments`:
- Reads immutable events from `inbox/robin/edits/*.jsonl` through
  `lib/edit-store.ts`, with **per-page** and **global** views.
- Each row: before/after diff, **origin badge** (you / agent / MCP), timestamp, summary, and a **revert** button.
- **Revert** = restore the whole snapshot through `writeWithHistory`, which
  logs a new immutable `edit.reverted` event. It is guarded by the expected
  current hash; divergence returns a conflict instead of applying a partial or
  anchor-scoped restore.

## 6. The editor — bake-off result

Three stacks were assessed and **adversarially probed** against the real `RobinBlock` union and the canonical serializer.

| Stack | Total /50 | Verdict |
|---|---|---|
| **Lexical** | **37** | **Recommended.** Best autosave + atomicity; ~15 custom nodes is the cost. `checked: boolean\|null` maps with no fork; format bitfield is 1:1 with `RobinMark`. |
| TipTap (ProseMirror) | 34 | Equal structural fit but heavier; needs a **fork** of the task-list extension for `checked=null`; `toDOM` is not canonical so you walk to blocks anyway. |
| Raw contentEditable | 26 | Cheapest baseline harness, but no schema constraint and missing safety primitives. Not the durable editor — useful only to stand up `htmlToBlocks` + the golden corpus first. |

### The decisive architectural finding

**The editor choice changes neither the serializer nor the parser.** Because `savePage` regenerates the body from `blocksToBodyHtml(blocks)` (no `bodyHtml` override), and because the rendered DOM is **triply mangled** (heading demotion + title-H1 stripping via `dedupeBodyHeadings`, wikilink href resolution + `data-broken` stamping via `resolveWikilinkHrefs`, and `<style>/<script>` stripping):

- The **load** path must parse the **canonical disk article** via `parseRobinHtmlCore` → a **standalone `htmlToBlocks`** — never the rendered body. Framework DOM importers (`importDOM`/`parseDOM`) **drop unmatched wrappers** and are hostile to the `html{raw}` escape hatch, so they cannot replace it.
- The **save** path is `lexicalToBlocks(editorState)` → `savePage({ path, frontmatter, blocks })` → existing `canonicalizeHtml`/`blocksToBodyHtml`. **Zero backend change.**
- Lexical builds its tree **from `RobinBlock`**, not from raw DOM. `importDOM` is used **for paste only**.

Convergence gate: `canonicalize(parse(canonicalize(blocks))) === canonicalize(blocks)`, and `htmlToBlocks(blocksToBodyHtml(b))` deep-equals `normalize(b)`.

### Editor wiring

- `RobinEditor` as a **client component, `dynamic(..., { ssr: false })`**, mounted behind an edit toggle, replacing the `robin-prose` div inside `FlowPageView`. The Annotator overlay is disabled in edit mode.
- **Title** is lifted out of the body into a **separate frontmatter-bound input** above the prose (preserves the single-H1 invariant; `lexicalToBlocks` drops a leading heading equal to the title).
- ~15 custom nodes with `exportJSON` and a `lexicalToBlocks` root walk:
  - **WikiLinkNode `extends TextNode`** keyed on `data-wiki`, so marks ride the node's format bitfield and wrap **outside** the anchor on serialize (matching `wrapMarks`). `exportDOM` is paste-only.
  - **callout** (+ `callout-title` as a plain-text field), **hubChildren** (read-only, empty, query-driven), **embeddedImage vs image** discriminated on `data-wiki`, **html-raw** (read-only, verbatim).
  - taskItem mapping: `getChecked()` boolean → task with that state; `undefined`/absent → `checked: null` (the plain item). This single mapping is what avoids the TipTap fork.
- **Autosave** (Phase 6, after the backstop lands): `editor.registerUpdateListener` debounced ~700ms, skip no-ops, tag the transaction `HISTORY_MERGE` so prosemirror/lexical history coalesces a typing run into one session step. Keep the editor state as the in-memory source of truth between loads — never re-parse the rendered DOM mid-session.

## 7. `htmlToBlocks` spec (`packages/converter/src/html-to-blocks.ts`)

Built as the **exact structural inverse** of `blocks-to-html.ts`. Parse with **`hast-util-from-html`** (already a dep, used by `parseRobinHtmlCore`) — **never regex the body**. Take the `article: Element` HAST node from `parseRobinHtmlCore`, then `htmlToBlocks(article): RobinBlock[]` switches on `tagName` + the camelCased `data-*` props hast produces (`data-block→dataBlock`, `data-callout→dataCallout`, `data-checked→dataChecked`, `data-embed→dataEmbed`, `data-query→dataQuery`, `data-lang→dataLang`, `data-wiki→dataWiki`). Inlines go through `hastInlinesToRobin(children): RobinInline[]`. Reuse `mdast-to-blocks.ts` as the **oracle** (same mixed-list / callout-title / inline-collapse logic) and `read-page.ts`'s `serializeHastNode` for the `html{raw}` fallback.

### Per-block rules (selected; full set in the parser)

- **heading** `<h1..6>` → `level = Number(tag[1])`, content via inlines. Parses every heading **verbatim** — title-stripping/demotion is a *render* concern never applied to disk HTML, so the editor loads the single body `<h1>` from disk and re-emits exactly one.
- **paragraph** `<p>` → inlines; drop whitespace-only `<p>` with zero element children (pretty-print artifact); keep a `<p>` containing only `<br>` or an empty `<a>`.
- **bulletList / numberedList** `<ul|ol data-block>` → items via `parseItemContent` (the **inline-collapse re-inflater**). `numberedList.start` only when present and `!= 1` (mirrors serializer guard).
- **taskList** `<ul data-block="taskList">` → dispatch on the **parent** marker; per `<li>`: `checked = (li.dataBlock==="task") ? (li.dataChecked==="true") : null`. `null !== false` (a plain item is not an unchecked task). Task items split into leading-inline `content` + trailing-block `children`.
- **codeBlock** `<pre [data-lang]><code>` → `lang` only if truthy; `code` = inner `<code>` text **already entity-decoded by hast** (don't re-unescape); preserve newlines.
- **quote** `<blockquote>` → recursive block parse (a blockquote is only ever a quote here; `[!type]` callouts are an mdast concern and serialize to `<aside>`).
- **callout** `<aside data-callout [data-collapsed]>` → peel optional leading `<header data-block="calloutTitle">` into a **plain-text** `title` (formatting flattened — matches the forward serializer's `escapeText(string)`); remaining children recurse; `collapsed:true` only when `dataCollapsed==="true"`.
- **image vs embeddedImage** `<figure data-embed="image">` → discriminate on `img.dataWiki` **non-empty** (embeddedImage: `slug`, `src` ignored) vs absent/empty (image: `src`, `alt` omitted when empty — never `alt:""`).
- **hubChildren** `<ul data-block="hubChildren" data-query>` → `{kind:'hubChildren', query}`; **discard any child `<li>`** (rendered snapshots inject resolved items that must not persist).
- **thematicBreak** `<hr>`. **table** → headers from `<thead><tr><th>`, rows from `<tbody><tr><td>` via inlines; parse cells **verbatim** (no re-pad/re-trim — the serializer re-normalizes to header width on next write, so idempotence holds).
- **html (fallback)** — any unrecognized block-position element (`<div>`, `<details>`, `<section>`, `<video>`, inline-SVG charts) → `{kind:'html', raw: serializeHastNode(node)}` using the reader's own serializer so the passthrough is canonical-stable. **Best-effort + lossy by design** for hand-authored exotic HTML; the *second* `canonicalize()` pass is the convergence guarantee, not first-pass byte-identity.

### Per-inline rules (selected)

- **text** — bare Text → `{kind:'text', text}` (hast-decoded). `<strong>/<em>/<s>` wrappers push `bold`/`italic`/`strike` onto every descendant inline that carries marks, deduped + alpha-sorted (`bold < italic < strike`) so `[italic,bold]` and nested `<strong><em>` both normalize to `['bold','italic']`. Merge adjacent same-mark text runs.
- **code** `<code>` not inside `<pre>` → `{kind:'code', text}` (+ marks if wrapped). **wikilink** `<a data-wiki>` → `slug = dataWiki`; `alias` only when `textContent !== slug`; **ignore `href` entirely** (derived/resolved) and regenerate `/p/slug` on save; marks live on the wrapping element (outside the anchor). **link** `<a href>` *without* `data-wiki` → `{kind:'link', href, content}`. **lineBreak** `<br>`.

### Round-trip test fixtures (extend `converter/test/round-trip.test.ts`)

Add an **inverse** assertion to every golden: `blocksToBodyHtml(htmlToBlocks(parse(r1.body))) === blocksToBodyHtml(r1.blocks)` and full-doc `canonicalizeHtml` convergence. New goldens:

- `11-callout.md` — `[!warning]-` collapsed, **bold** in title (assert documented title-flatten loss), nested body + nested bullet list.
- `12-code.md` — fenced `ts` with `a < b && c > d` and literal `&amp;`; plus a no-language fence (no `data-lang`).
- `13-mixed-task-list.md` — `[ ]` / `[x]` / plain item / task-with-children; assert bare-`<li>` vs `data-checked` discrimination.
- `14-inline-marks.md` — `**[[page]]**`, **`code`**, `~~[text](url)~~`, nested `*…**…***`, hard break; assert marks-outside-the-anchor + dedupe/sort.
- `15-table-ragged.md` — short + over-long body rows; assert pad/trim to header width and second-pass byte stability.
- `16-embedded-and-linked-image.md` — `![[diagram.png|cap]]` vs plain `![alt](url)`; assert `data-wiki` discrimination + `alt` omission.
- `17-html-fallback.md` — inline-SVG chart + `<details>`; assert `{kind:'html'}` via `serializeHastNode` (svg `viewBox` camelCase preserved, no `<style>/<script>`), re-emits verbatim.
- **skew unit test** — hand-built rendered-DOM body (resolved hrefs, stripped title H1, injected hub `<li>`); assert wikilink `slug` is href-independent, hubChildren has only its query, and `canonicalizeHtml` regenerates `href="/p/foo"`.

## 8. Ingest the edit stream

A new `ingest-source/edits` drain + a **remsleep Phase-1 hook**:
- Reads `inbox/robin/edits/*.jsonl`, skips reverted and **ingest-originated** (`origin='mcp'` from the nightly skill) events to prevent self-feeding.
- Classifies each edit's diff (snapshot → current) with the existing `LearnCategory` enum; **aggressively filters** typo/canonicalize-churn (a raw diff carries less intent than an annotation `comment_md`, so the bar is high).
- Promotes durable facts via `memory_save` with a **new `source.kind='edit'`** — added to **both** `MemorySourceSchema` *and* `MEMORY_SOURCE_KINDS` in one commit (the writer/reader-skew rule).
- Closes the loop with an `edit.ingested` event.
- "Ingest an edit" = **record-as-changelog + extract any durable fact**, never *re-apply* (the edit is already-applied content).

## 9. Version control and backup boundary

Per-save back-step comes from referenced snapshots plus the append-only edit
ledger. Repository commits are made at reviewed workflow boundaries; no daily
commit schedule is part of the durability contract. Git and its remote do not
cover ignored pending receipts or uncommitted bytes and are not a backup. Back
up the vault independently and exercise a restore that includes canonical
pages, edit ledgers, referenced snapshots, and any pending recovery evidence.

## 10. Phased plan

Each phase is independently shippable. Phases 0–2 deliver a working edit **log + back-step for agent/MCP edits before any human editor exists** — value lands early.

| Phase | Ships | Notes |
|---|---|---|
| **0 · Write choke point** | `packages/vault-io` `writeWithHistory`; route web + MCP through it; before/after hash + no-op on equal | Pure refactor; collapses duplicated writers. Everything below inherits history for free. |
| **1 · History + event stream** ✅ | `base/.history/<path>/<ts>__<hash>.html` prior-byte snapshots; `inbox/robin/edits/<YYYY-MM>.jsonl` immutable events; transaction receipts and proof-based recovery; MCP origin/tool attribution; cross-process locks; optimistic concurrency; lifecycle-aware move/delete; incremental index refresh. Referenced snapshots are never silently pruned. | Unreferenced snapshots use the implemented 30-day-all / daily-through-90 / weekly-after policy. Referenced expiry remains unsupported. |
| **2 · `/edits` list + back-step** ✅ | `lib/edit-store.ts` reads immutable events directly; `/edits` groups them by page with kind/origin badges + before→after hashes + "view prior version"; `revertToSnapshot` (POST `/api/edits`) restores the whole snapshot as a new `edit.reverted` write; `EditActions` Restore button; `Edits` nav entry. Divergence returns a CAS conflict; there is no partial fallback. | |
| **3 · `htmlToBlocks` + tests** ✅ | `converter/src/html-to-blocks.ts` — structural inverse of `blocks-to-html.ts` via `hast-util-from-html`; `html{raw}` fallback via `hast-util-to-html`. Round-trips every canonical body exactly (verified across all goldens 01–16 + structural tests for mixed task lists, bold-wrapped wikilinks, callouts, ragged tables, code entities, embedded-vs-linked images; html-fallback converges on 2nd pass). Exported as `htmlToBlocks` / `htmlBodyToBlocks`. | Gate met: round-trip stable before any editor ships. |
| **4 · `getPageForEdit` load path** ✅ | `lib/page-edit.ts` parses the **canonical disk article** (not the deduped render) via `parseRobinHtmlCore` → `htmlToBlocks`; gates to `brain/` pages and refuses any page that produces an `html{raw}` block (= unrepresentable markup: inline SVG/style/class/custom tags). Exposed at `GET /api/page/edit?path=`. | The safety boundary, tested. |
| **5 · Lexical editor (explicit-save)** | install `lexical` + react/list/link/code/table/utils/html; `RobinEditor` (`ssr:false`) behind edit toggle in `FlowPageView`; title input; ~15 nodes; `lexicalToBlocks`; save via `savePage`→`writeWithHistory`; disable Annotator in edit mode | Explicit Save button first. |
| **6 · Enable debounced autosave** | `registerUpdateListener` ~700ms, skip no-ops, `HISTORY_MERGE` tag | Safe **now** because the Phase 0/1 backstop + idempotence gate exist. This is where your autosave choice turns on. |
| **7 · Ingest the stream** | `ingest-source/edits` drain + remsleep hook; classify → `memory_save` (`source.kind='edit'`); `edit.ingested`; trivia + self-feed filters | |
| **8 · backup and recovery operations** | independent vault backup, restore drill, Doctor inspection, and proof-based pending-receipt recovery | Git workflow is deliberately separate from the recovery contract. |

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| contentEditable→canonical-HTML corruption (the fragile heart) | Schema-constrained Lexical (not raw DOM) + standalone `htmlToBlocks` + idempotence gate `canonicalize(x)===canonicalize(canonicalize(x))` before every write. |
| Autosave history explosion | Hash-equal no-op is implemented; session coalescing remains part of the future editor design. Referenced snapshots are preserved until an explicit retention/archive policy is approved. |
| Capturing all 3 origins is aspirational | Web + MCP caught in-process; direct file edits best-effort via remsleep diff; governance nudge to MCP. |
| `html{raw}` / exotic HTML loss (one `out/` doc has inline-SVG + `style`) | Refuse edit mode on non-representable pages (gate to converter-shaped brain pages, v1); `html{raw}` is best-effort with second-pass convergence. |
| Canonical bytes + audit stream diverge after a crash | Durable receipts fail closed; proof-based recovery may finalize only the audit side when canonical hashes match. |
| Stale FTS after edit/revert | Incremental path refresh runs after committed writes and lifecycle changes; on first actual index use the lazy indexer scans and starts its watcher as the fallback repair path. |
| Ingest self-feeding loop | Drain filters reverted + `origin='mcp'` ingest edits; high trivia bar. |

## 12. Open decisions (proposed defaults — two worth confirming)

1. **`out/` scope** *(confirm)* — gate the editor to converter-shaped **brain pages** for v1; keep `out/` artifacts read-only (some have `style`/inline-SVG/`class` that the block model can't represent, and `style` is stripped before the editor sees it). *Recommended: gate to brain pages.*
2. **Callout title** — plain-text input (the serializer flattens it to a string anyway; bold/links in a title are lost on round-trip). *Recommended: plain-text; callouts are nearly absent in the vault.*
3. **Autosave vs explicit save** — ship **explicit-save first** (Phase 5), turn on **debounced autosave** once the `writeWithHistory` backstop + idempotence gate land (Phase 6). This honors the autosave decision while never risking an irreversible bad autosave. *Recommended & reflected in the phasing.*
4. **Title UX** *(confirm)* — a distinct title field above the prose (not an inline first heading), to preserve the single-H1 invariant. *Recommended.*

---

*Design produced via a mapped study of the six relevant subsystems → three competing architectures (judged) → an editor bake-off (TipTap / Lexical / contentEditable) adversarially probed against the real `RobinBlock` schema, plus a standalone `htmlToBlocks` spec.*
