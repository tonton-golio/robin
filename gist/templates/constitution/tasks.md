# Tasks

Tasks live in `brain/tasks/<slug>.html` as canonical HTML pages. Per the format spec, they use `<meta name="robin:status">` (not `state`) and a structured set of frontmatter fields.

## What becomes a task

A task is an **actionable item** with:

- A completion state — it can be `done`.
- Persistence across days — it survives if you don't finish it today.
- A blocker condition or a clear scope.

Not everything goes here:

| Item | Where it goes |
|---|---|
| Action item with completion state, multi-day life | `brain/tasks/<slug>.html` |
| Feature checklist for a project | Inline in the project / feature page |
| Process checklist (one-time, project-specific) | Inline in the playbook or process page |
| One-off reminder that doesn't outlive today | Don't create a task; just remember |

When in doubt, create the task. It's cheaper to archive a useless task than to lose a real one.

## Lifecycle

```
open → in-progress → done
              ↓
         dropped | superseded | cancelled
              ↓
           blocked
```

- **`open`** — captured, not yet started.
- **`in-progress`** — actively being worked.
- **`done`** — completed.
- **`blocked`** — waiting on something external; explain in the body.
- **`dropped`** — decided not to do.
- **`superseded`** — replaced by another task; set `robin:superseded_by`.
- **`cancelled`** — never going to happen; document why.

## Workflow (separate from status)

| Workflow | Meaning |
|---|---|
| `inbox` | Captured but not triaged. |
| `next` | Ready to pick up. |
| `active` | Currently being worked. |
| `waiting` | Waiting on someone or something. |
| `review` | Work done, needs review. |
| `scheduled` | Known future work. |
| `backlog` | Intentionally not near-term. |

Status answers "is this done?" Workflow answers "where in the queue is this?"

## Frontmatter contract

Required:

```html
<meta name="robin:type" content="task">
<meta name="robin:status" content="open">
<meta name="robin:summary" content="One-line description.">
<meta name="robin:created" content="2026-05-28T14:00:00Z">
<meta name="robin:updated" content="2026-05-28T14:00:00Z">
```

Preferred (almost always):

```html
<meta name="robin:priority" content="p2">
<meta name="robin:workflow" content="next">
<meta name="robin:owner" content="{{USER_NAME}}">
<meta name="robin:project" content="some-project-slug">
<meta name="robin:source" content="manual">
```

Optional (used when relevant):

```html
<meta name="robin:due" content="2026-06-15">
<meta name="robin:category" content="bug-fix">
<meta name="robin:started" content="…">
<meta name="robin:completed" content="…">
<meta name="robin:archive_reason" content="dropped because…">
<meta name="robin:blocked_by" content="other-task-slug">
<meta name="robin:depends_on" content="other-task-slug">
<meta name="robin:superseded_by" content="replacement-slug">
<meta name="robin:next_action" content="Write the migration script.">
<meta name="robin:acceptance" content="Tests pass; deploy is green.">
<meta name="robin:sensitivity" content="private">
```

**Critical:** never use `<meta name="robin:state">` for tasks. Tasks use `status`. The skills that surface tasks filter on `status`. Using `state` makes a task invisible.

## Priority mapping

| Priority | Meaning |
|---|---|
| `p0` | Today. Drop other things. |
| `p1` | This week. |
| `p2` | This month. |
| `p3` | Backlog. Maybe never. |

`/morning-brief` surfaces all P0 + all P1 + everything overdue. `/check-tasks` groups by priority.

## Task surfacing

| Skill | What it shows |
|---|---|
| `/morning-brief` | All P0, all P1, overdue, blocked-without-explanation. |
| `/check-tasks` | Active tasks grouped by priority + health flags. |
| `/check-tasks --quick` | Hand-curated `brain/tasks/_index.html` + last 5 changelog entries. |
| `/remsleep` | Flags stale tasks (no updates in 3+ days while open/in-progress), suggests adjustments. |

Stale tasks aren't bugs — they're a signal. Either pick them up, push them out, or drop them.

## Creating tasks

Use `/create-task`. The skill encodes:

- Default priority (`p2` unless specified).
- Default owner ({{USER_NAME}}).
- Default workflow (`next`).
- Default source (`manual`).
- Slug derivation from title.
- Side effects: page created, `logs/changelog.md` appended.

Direct page creation works too, but `/create-task` enforces the conventions.

## Task indexing

`brain/tasks/_index.html` is a hand-curated rollup, **not** an operational source. It's what `/check-tasks --quick` reads for a fast view. Keep it short: a section per priority, just the P0/P1 items, one line each with a wikilink.

The operational source of truth is the `brain/tasks/*.html` files themselves. The index is convenience.

## Archive

When a task reaches `done`:

- Leave it in `brain/tasks/` for ~14 days so it shows up in recent history.
- Move to `brain/tasks/archive/<slug>.html` after 14 days. (Or weekly during `/remsleep` cleanup.)
- Done tasks in archive are still queryable, still link-resolvable; they just don't clutter the active set.

The same applies to `dropped`, `superseded`, `cancelled` — these go to archive immediately (or at the next maintenance pass).

## When to break the rules

- A massive task with sub-tasks: prefer a project under `brain/projects/<slug>/` with the sub-tasks as features or its own task subset. Don't create deeply nested tasks.
- A recurring task (weekly digest, monthly close): consider whether it should be a *playbook* instead, with each run logged inline.

If a "task" keeps coming back, it's probably a habit or a recurring procedure. Convert to a playbook.
