---
name: check-tasks
description: Scan all tasks, flag overdue / stale items, report health by priority. Brain-only; no external calls.
---

# /check-tasks

## Purpose

Surface the active task set with health flags. Used at mid-day re-orientations and as part of `/morning-brief`.

## When to use

- Mid-day, when re-orienting between contexts.
- As a sub-skill called by `/morning-brief`.
- Manually when the task queue feels chaotic.

## Arguments

- `--quick` (optional) — fast path: reads `brain/tasks/_index.html` directly (the hand-curated rollup). Output ~20 lines max.
- `--project=<slug>` (optional) — filter to a specific project.
- `--owner=<name>` (optional) — filter to a specific owner.

## Steps

### Quick mode (`--quick`)

1. Read `brain/tasks/_index.html`.
2. Read the last 5 entries from `logs/changelog.md`.
3. Print both, concise. Done.

### Full mode

1. **List all task pages.** Walk `brain/tasks/*.html` (excluding `archive/`). For each:
   - Read frontmatter: `robin:status`, `robin:priority`, `robin:due`, `robin:owner`, `robin:project`, `robin:updated`.
   - Skip non-task pages (those with `robin:type != "task"`).

2. **Filter.**
   - Apply `--project=` or `--owner=` filters if given.
   - Bucket: active (`status` in {open, in-progress, blocked}) vs. done/archived.
   - Default to active only.

3. **Sort.**
   - Primary: priority (p0 → p1 → p2 → p3).
   - Secondary: due (earliest first), nulls last.
   - Tertiary: updated (most recent first).

4. **Compute health flags:**
   - **Overdue:** `robin:due` < today AND status not in {done, superseded, cancelled}.
   - **Stale:** `robin:updated` < today − 3d AND status in {open, in-progress}.
   - **Blocked-without-explanation:** `status == blocked` AND no body explanation.
   - **High-priority without due:** `priority` in {p0, p1} AND no `robin:due`.
   - **Done recently:** `status == done` AND `updated` >= today − 7d (surface as positive signal).

5. **Compose the report** using [`../lib/report-template.md`](../lib/report-template.md):

   ```markdown
   ### Tasks

   **P0 — today** (N)
   - [[task-slug]] (due YYYY-MM-DD) — summary [overdue!]

   **P1 — this week** (N)
   - [[task-slug]] (due YYYY-MM-DD) — summary

   **P2** (N)
   - [[task-slug]] — summary [stale 5d]

   **P3** (N)
   - (Just count, optionally list.)

   **Health flags**
   - Overdue (N): [[task-slug]], [[task-slug]]
   - Stale (N): [[task-slug]]
   - Blocked-without-explanation (N): [[task-slug]]
   - P0/P1 without due (N): [[task-slug]]

   **Recent wins**
   - Done in last 7 days: N. [[task-slug]] ([[task-slug]] …)
   ```

6. **Don't write anything to disk.** This is a read-only skill.

## Output shape

- Quick mode: ~20 lines max.
- Full mode: as long as the task set requires, but most days under 40 lines.

## Edge cases

- **No tasks.** Output "No open tasks." Skip the rest.
- **Task with `robin:state` instead of `robin:status`.** Surface as a frontmatter bug to fix via `/lint-wiki`. Don't silently include it (the filter on `status` excludes it).
- **Task with no priority.** Treat as `p3` and surface a flag suggesting the user set one.
- **Done tasks older than 14 days.** Suggest archiving (move to `brain/tasks/archive/`).

## Side effects

None. Read-only.

## Notes

- The hand-curated `brain/tasks/_index.html` is your *fast path*. Keep it tight — just P0/P1 with wikilinks. The skill doesn't auto-update the index; that's a manual or `/remsleep`-time choice.
- The skill never *creates* tasks. Use `/create-task` for that.
