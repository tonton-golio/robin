# Maintenance

The brain is a living artifact. Without maintenance, it accretes drift: stale dates, broken links, orphaned pages, dead-letter hubs.

This file defines the health checks, the cleanup discipline, and the conventions for restructure.

## Health checks

`/lint-wiki` runs these (some auto-fix, some surface for human review):

| Check | Description |
|---|---|
| Orphans | Pages with no inbound wikilinks. Either link them or archive. |
| Broken wikilinks | `data-wiki` references with no matching page. |
| Ambiguous wikilinks | `data-wiki` with multiple matching slugs. |
| Stale dates | Pages with `robin:updated` >30 days old in active areas. |
| Stale hubs | Hubs with `robin:last_reconciled` >14 days old. |
| Frontmatter drift | Missing required meta tags (`version`, `slug`, `path`, `type`, `updated`). |
| Status vs. state mistakes | Tasks using `robin:state` instead of `robin:status`. |
| Repeated topics without pages | Patterns surfacing across the brain that don't yet have a canonical page. |
| Orphaned `_index.html` | Index pages out of sync with the directory contents. |

## Deletion discipline

**Never `rm -rf`** a brain page. Move to an archive with a timestamp:

```bash
mv brain/projects/old-project ~/.Trash/old-project-$(date +%Y%m%d-%H%M%S)
```

Or, for project-internal archives:

```bash
mv brain/projects/old-project/ brain/projects/old-project/archive/
```

Why: the trail matters. Wikilinks may still resolve (archived pages render struck-through). Audit trails depend on history.

## Restructure rules

When moving or renaming pages:

1. **Update every backlink** referencing the page. Use `grep` (or the MCP search) to find them.
2. **Add an alias** in `.robin/aliases.json` if the slug changed: `{"old-slug": "new-slug"}`. Aliases are forever.
3. **Update `_index.html`** in the affected directories.
4. **Append an entry** to `logs/changelog.md` documenting the restructure.

When splitting one page into multiple:

1. Keep the original page as a thin stub linking to the new ones.
2. After all incoming references update, archive the stub (don't delete — the slug might still be referenced externally).

## The changelog format

`logs/changelog.md` is the operational audit log. One entry per maintenance pass / `/learn` invocation / restructure / significant edit. Reverse-chronological (newest at top).

Entry format:

```markdown
## [YYYY-MM-DD] <verb> | <one-line summary>

What was found, what was fixed, what was deferred. Link affected pages.
```

Verbs:

- `ingest` — `/ingest-*` ran.
- `create` — new page or task created.
- `update` — existing content modified.
- `restructure` — pages moved or renamed.
- `lint` — `/lint-wiki` ran.
- `enrich` — `/learn` ran.
- `remsleep` — `/remsleep` ran.
- `task` — task created via `/create-task`.
- `hub` — hub created or reconciled.
- `archive` — pages moved to archive.

Multiple verbs separated by `+`: `## [2026-05-28] update + hub | Reconciled agent-frameworks hub, added [[crewai]]`.

## Hub health

Hubs decay faster than other pages because the world they index moves.

- Reconcile every 14 days.
- Every hub ends with `## Known gaps`. Update during reconciliation.
- `/lint-wiki` flags hubs older than 14 days.
- `/remsleep` Phase 3 (synthesis) scans recent activity for entities that should be on hubs.

A hub with stale entries is worse than no hub. If you can't keep a hub fresh, retire it (move to `brain/hubs/legacy/`).

## Restructure cadence

A few times a year, do a deeper restructure:

- Walk the brain.
- Spot patterns of similar pages that could merge.
- Identify directories that grew tendrils into the wrong places.
- Promote hubs from `_index.html` directory rollups when a directory's contents diverge in theme.

Restructure is heavy. Don't do it weekly. Do it when navigating feels harder than the work itself.

## `_index.html` sync

Every top-level directory and most subdirectories have an `_index.html`. Update them when:

- A new substantive page is added.
- A page is moved or renamed.
- The directory's topic mix changes meaningfully.

Don't update for every minor edit — the `_index.html` lists *substantive* contents, not every file.

## Stale-date semantics

`robin:updated` ≠ "last touched on disk." It is "last semantically updated." If you fix a typo, you may not bump `robin:updated`. If you change a fact, you must.

The semantics matter: `robin:updated` signals how recent the knowledge is. A page with `updated: 2024-01` is implicitly less reliable than one with `updated: 2026-05`, even if both are technically active.

## The maintenance budget

You will spend ~10–15% of total brain-work time on maintenance. That ratio is healthy.

If you spend more, the brain is over-elaborate. Simplify.

If you spend less, the brain is drifting. The signal is when you start ignoring `/lint-wiki` output or accumulating `needs-review` pages that never get curated.

## Operational tooling

Common useful commands (in a lightweight setup, run manually):

```bash
# Find orphans
grep -L 'data-wiki=' brain/**/*.html

# Find broken wikilinks
grep -r 'data-broken' brain/

# Find stale pages (>30 days)
grep -l 'robin:updated' brain/**/*.html | xargs -I{} ...  # (script needed; or use lint-wiki)

# List all slugs
grep -rh 'name="robin:slug"' brain/ | sort
```

In a powered-up setup, `vault.lint` and `vault.stats` from the MCP server do this faster.
