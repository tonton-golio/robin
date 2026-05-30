---
name: lint-wiki
description: Parallel-agent vault audit — structural lint plus per-directory scouts to catch what the engine can't (cross-refs, hub gaps, content quality, naming, semantic drift).
---

# /lint-wiki

## Purpose

Run a comprehensive vault health audit. Catches: frontmatter drift, broken / ambiguous wikilinks, orphan pages, stale dates, hub decay, content quality issues, and naming inconsistencies.

## When to use

- Before `/remsleep` (hard precondition — `/remsleep` halts if lint hasn't run today).
- Whenever the brain feels noisy or hard to navigate.
- After a restructure to verify integrity.
- Periodically (weekly is healthy).

## Phases

### Phase 1 — Structural engine pass

Run the structural checks (in a powered-up setup, use `vault.lint` and `vault.stats` from the MCP server; in a lightweight setup, use grep / scripts).

Checks:

| Check | What |
|---|---|
| Frontmatter conformance | Required meta tags (`version`, `slug`, `path`, `type`, `updated`) present. |
| Broken wikilinks | `data-wiki` references with no matching page. |
| Ambiguous wikilinks | `data-wiki` matching multiple slugs. |
| Orphans | Pages with no inbound wikilinks. |
| Schema drift | Tasks using `state` instead of `status`. Repeated meta tags joined with commas. Old format markers (v0.1 JSON blocks). |
| Stale `updated` | Pages with `robin:updated` >30 days old in active areas. |
| `_index.html` drift | Index pages out of sync with directory contents (links to files that don't exist; missing links to new files). |

Capture results as a baseline.

### Phase 2 — Per-directory semantic scouts

Dispatch one sub-agent per top-level brain directory (or per bundle of small directories). Each scout:

- Stays in its assigned directory only.
- Makes mechanical fixes only (no semantic restructure).
- Does NOT delete or commit.
- Flags semantic issues to the orchestrator.

Suggested directory groupings (adapt to your structure):

| Scout | Directories |
|---|---|
| **Scout 1** | `brain/projects/` |
| **Scout 2** | `brain/people/` |
| **Scout 3** | `brain/hubs/` — special checks: `## Known gaps` present, `last_reconciled` within 14 days, entry format consistent. |
| **Scout 4** | `brain/tools/`, `brain/repos/` |
| **Scout 5** | `brain/decisions/`, `brain/standards/`, `brain/patterns/`, `brain/playbooks/`, `brain/unknowns/` |
| **Scout 6** | `brain/about_user/`, `brain/strategy/` |
| **Scout 7** | `brain/tasks/`, `brain/work-log/`, `brain/annotations/` |
| **Scout 8** | `brain/memory/`, root pages (`brain/_index.html`, etc.) |

Each scout reports:
- Auto-fixed issues (with counts).
- Flagged-for-human issues (with specific paths and explanations).

### Phase 3 — Triage and fix

In the main orchestrator context:

**Auto-fix (silent):**
- Missing `robin:updated` → add with current ISO-8601 UTC.
- Broken `data-wiki=` slug-only refs where the target is unambiguous after slug normalization → fix.
- Whitespace and format drift per the format spec.
- Comma-joined `robin:tag` → split into repeated meta tags.

**Flag for human:**
- Orphans (pages with no inbound wikilinks).
- Stale pages (`updated` >30 days) in active areas.
- Hubs missing `## Known gaps` or with `last_reconciled` >14 days old.
- Naming violations (non-kebab-case slugs, mismatched filenames).
- Repeated-topic gaps (hub candidates).
- Schema drift the engine couldn't auto-fix (e.g., a task with `state` instead of `status` — the auto-fix changes the tag, but if the page has body content referring to "state", that's a flag).

### Phase 4 — Report

Compose a report:

```markdown
## /lint-wiki — YYYY-MM-DD

### Vault stats
- N pages
- N memory events
- N broken wikilinks
- N orphans
- N stale pages

### Auto-fixed
- Updated N `robin:updated` timestamps.
- Fixed N broken slug references.
- Split N comma-joined tag tags.

### Needs your input
- **Orphans** (N): [link to each]
- **Stale pages** (N): [link, with date]
- **Hubs needing reconciliation** (N): [link to each]
- **Naming violations** (N): [link, with suggested rename]
- **Hub candidates** (N): [topic + scattered references]

### Hub health
- (Per-hub): [hub] · entries: N · last_reconciled: YYYY-MM-DD · status: ok/stale.
```

Append to `logs/changelog.md`:
```
## [YYYY-MM-DD] lint | /lint-wiki — <one-line summary>
```

Save the full report to `logs/reports/YYYY-MM-DD-lint-wiki.html` (Robin v0.2, `robin:type=report`).

## Output shape

Chat summary: counts + needs-your-input section. The full report is in `logs/reports/`.

## Edge cases

- **No brain pages yet.** Lint produces an empty report; useful as a smoke test of the setup.
- **Sub-agent out of scope.** If a scout reports work it did outside its directory, that's a bug. Investigate.
- **Auto-fix would be lossy.** Don't auto-fix; flag instead.
- **A `_index.html` is wildly out of sync.** Don't auto-rebuild; flag with a recommendation to run a directory-specific cleanup.

## Side effects

- Reads everything under `brain/`.
- Writes `logs/changelog.md`.
- Writes `logs/reports/YYYY-MM-DD-lint-wiki.html`.
- May write small auto-fixes to pages (frontmatter timestamps, link normalizations).
- Does NOT delete or restructure.
