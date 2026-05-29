# Frontmatter reference

Every page in `brain/` and active `out/` carries metadata via `<meta name="robin:*">` tags in `<head>`. This document lists every supported meta tag with its semantics.

For the page skeleton and broader format, see [`page-format.md`](./page-format.md).

## Conventions

- **Cardinality `1`** — exactly one of this tag must appear.
- **Cardinality `0..1`** — at most one.
- **Cardinality `0..*`** — zero or more (the tag may repeat).
- All `robin:*` tags are read-only after canonicalization; treat them as the source of truth.

## Universal tags

These apply to all page types.

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| `robin:version` | 1 | string | Spec version. Currently `0.2`. |
| `robin:slug` | 1 | string | Kebab-case. The slug matters for wikilink resolution. |
| `robin:path` | 1 | string | Vault-relative path. The identity. |
| `robin:type` | 1 | enum | See [type vocabulary](./page-format.md#type-vocabulary). |
| `robin:updated` | 1 | ISO-8601 UTC | Set on every save. |
| `robin:created` | 0..1 | ISO-8601 UTC | Set once on create. |
| `robin:state` | 0..1 | enum | Lifecycle state. See per-type sections below. |
| `robin:summary` | 0..1 | string | One-line summary. ≤120 chars. Surfaced in search. |
| `robin:tag` | 0..* | string | One tag per meta element. Never comma-joined. |
| `robin:owner` | 0..1 | string | Person responsible. |
| `robin:source` | 0..* | string | Vault-relative paths to inbox source files. |

## `type=task`

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| `robin:status` | 1 | enum | `open` \| `in-progress` \| `done` \| `blocked` \| `dropped` \| `superseded` \| `cancelled`. |
| `robin:priority` | 0..1 | enum | `p0` \| `p1` \| `p2` \| `p3`. Higher number = lower priority. |
| `robin:due` | 0..1 | ISO-8601 date | Format: `2026-06-15`. No time component. |
| `robin:workflow` | 0..1 | enum | `inbox` \| `next` \| `active` \| `waiting` \| `review` \| `scheduled` \| `backlog`. |
| `robin:project` | 0..1 | string | Project slug. |
| `robin:category` | 0..1 | string | Free-form. |
| `robin:started` | 0..1 | ISO-8601 UTC | When work began. |
| `robin:completed` | 0..1 | ISO-8601 UTC | When marked `done`. |
| `robin:archive_reason` | 0..1 | string | Why a task was dropped/superseded/cancelled. |
| `robin:blocked_by` | 0..* | string | Slug(s) of blocking tasks. |
| `robin:depends_on` | 0..* | string | Slug(s) of dependent tasks. |
| `robin:superseded_by` | 0..1 | string | Slug of replacing task. |
| `robin:next_action` | 0..1 | string | One-line concrete next step. |
| `robin:acceptance` | 0..1 | string | Acceptance criterion. |
| `robin:sensitivity` | 0..1 | enum | `public` \| `private` \| `confidential`. |

**Critical:** tasks use `robin:status`, **not** `robin:state`. The skills that surface tasks filter on `status`. Pages with `state` instead of `status` become invisible to `/check-tasks` and `/morning-brief`.

## `type=person`

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| `robin:role` | 0..1 | string | Free-form role description. |
| `robin:relationship` | 0..1 | enum | `direct-report` \| `stakeholder` \| `external` \| `candidate`. |
| `robin:started` | 0..1 | ISO-8601 date | When the relationship began. |
| `robin:state` | 0..1 | enum | `stable` \| `archived`. |

People rarely need lifecycle states. Use `stable` once you've curated the page; `archived` when off-boarding.

## `type=project`

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| `robin:state` | 0..1 | enum | `active` \| `paused` \| `archived` \| `evolving`. |
| `robin:owner` | 0..1 | string | Project lead. |

Projects don't have `priority` — that lives on tasks within the project.

## `type=decision`

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| `robin:date` | 1 | ISO-8601 date | When the decision was made. |
| `robin:state` | 0..1 | enum | `stable` \| `superseded` \| `canonical` (rare). |
| `robin:superseded_by` | 0..1 | string | Slug of replacing decision. |

Decision filenames should be date-prefixed: `YYYY-MM-DD-<slug>.html`.

## `type=meeting`, `type=interview`

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| `robin:date` | 1 | ISO-8601 date | Meeting date. |
| `robin:attendee` | 0..* | string | One per attendee. |
| `robin:duration` | 0..1 | string | E.g., `"45 min"`. |
| `robin:source` | 0..* | string | Path to the transcript. |

Meetings live in `logs/meetings/` (generated artifacts). The transcript stays in `inbox/meetings/` (immutable).

## `type=hub`

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| `robin:last_reconciled` | 0..1 | ISO-8601 date | When the hub was last reviewed for staleness. |
| `robin:state` | 0..1 | enum | `stable` \| `evolving`. |

Hubs should be reconciled at least every 14 days. `/lint-wiki` flags hubs older than that.

## `type=brief`, `type=report`, `type=remsleep`, `type=reflection`

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| `robin:date` | 1 | ISO-8601 date | Date the artifact covers. |
| `robin:state` | 0..1 | enum | Usually `final` or omitted; reports are point-in-time. |

These types are typically generated by skills; you rarely write them by hand.

## `type=pattern`, `type=standard`, `type=playbook`

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| `robin:state` | 0..1 | enum | `needs-review` \| `stable` \| `canonical`. |
| `robin:scope` | 0..1 | enum | `global` \| `project:<slug>` \| `repo:<slug>`. |

Standards reach `canonical` when the team has explicitly ratified them. Patterns and playbooks usually stay `stable`.

## `type=index`

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| (universal tags only) | | | |

Index pages (`_index.html`) are the directory-level navigation. Keep them light.

## `type=note`, `type=knowledge`, `type=understanding`, `type=reference`

These are generic types for material that doesn't fit a more specific type. Prefer the more specific type when one applies.

| Tag | Cardinality | Type | Notes |
|---|---|---|---|
| `robin:state` | 0..1 | enum | `needs-review` \| `stable` \| `canonical`. |

## Authoring tip: a complete `<head>` for a typical project page

```html
<head>
  <meta charset="utf-8">
  <title>Site rebuild</title>
  <link rel="canonical" href="/p/site-rebuild">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="site-rebuild">
  <meta name="robin:path" content="brain/projects/site-rebuild/site-rebuild.html">
  <meta name="robin:type" content="project">
  <meta name="robin:state" content="active">
  <meta name="robin:created" content="2026-01-12T09:15:00Z">
  <meta name="robin:updated" content="2026-05-28T14:32:00Z">
  <meta name="robin:summary" content="Replace the 2019 marketing site with a modern stack.">
  <meta name="robin:owner" content="jamie">
  <meta name="robin:tag" content="marketing">
  <meta name="robin:tag" content="website">
</head>
```

And a typical task page:

```html
<head>
  <meta charset="utf-8">
  <title>Migrate hero copy</title>
  <link rel="canonical" href="/p/migrate-hero-copy">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="migrate-hero-copy">
  <meta name="robin:path" content="brain/tasks/migrate-hero-copy.html">
  <meta name="robin:type" content="task">
  <meta name="robin:status" content="open">
  <meta name="robin:priority" content="p2">
  <meta name="robin:workflow" content="next">
  <meta name="robin:due" content="2026-06-15">
  <meta name="robin:owner" content="jamie">
  <meta name="robin:project" content="site-rebuild">
  <meta name="robin:created" content="2026-05-28T14:00:00Z">
  <meta name="robin:updated" content="2026-05-28T14:32:00Z">
  <meta name="robin:summary" content="Port the hero section copy from the legacy CMS to the new repo.">
</head>
```

See also:

- [`page-format.md`](./page-format.md) — the page skeleton and body rules.
- [`wikilinks.md`](./wikilinks.md) — link syntax.
- [`memory-events.md`](./memory-events.md) — memory event schema.
