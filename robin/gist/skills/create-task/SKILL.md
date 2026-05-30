---
name: create-task
description: Create a task page in brain/tasks/ with the canonical frontmatter, default fields, project guardrails, and a changelog entry.
---

# /create-task

## Purpose

Encode task-creation policy on top of the page-creation primitive. Ensures every task has the right frontmatter (`status`, not `state`), reasonable defaults, and a changelog entry.

## When to use

- The user asks to create a task ("add a task to X", "track this", "remind me to Y").
- A skill (`/ingest-meeting`, `/learn`, `/ingest-source`) needs to create tasks for action items.

## Arguments

- `<description>` (required) — natural language description of the task.
- `--project=<slug>` (optional) — project to associate with.
- `--priority=<p0|p1|p2|p3>` (optional) — default `p2`.
- `--due=<YYYY-MM-DD>` (optional).
- `--owner=<name>` (optional) — default `{{USER_NAME}}`.

## Steps

1. **Parse the description.** Extract:
   - A short slug (kebab-case, 2–5 words).
   - A one-line summary (≤120 chars).
   - Inferred project (if obvious from context).

2. **Infer project** if not specified:
   - From recent conversation context.
   - From the source file if creation was triggered by `/ingest-*`.
   - If still ambiguous, ask.

3. **Apply defaults:**
   - `priority: p2`
   - `owner: {{USER_NAME}}`
   - `workflow: next`
   - `source: manual` (unless invoked by another skill — then use that skill's name or the source path).
   - `status: open`

4. **Build the frontmatter** (use `status`, **not** `state`):

   ```html
   <meta name="robin:version" content="0.2">
   <meta name="robin:slug" content="{slug}">
   <meta name="robin:path" content="brain/tasks/{slug}.html">
   <meta name="robin:type" content="task">
   <meta name="robin:status" content="open">
   <meta name="robin:priority" content="p2">
   <meta name="robin:workflow" content="next">
   <meta name="robin:owner" content="{{USER_NAME}}">
   <meta name="robin:source" content="manual">
   <meta name="robin:created" content="{ISO-8601 UTC now}">
   <meta name="robin:updated" content="{ISO-8601 UTC now}">
   <meta name="robin:summary" content="{summary}">
   ```

   Plus any optional fields supplied by arguments (`due`, `project`, `category`, `acceptance`, `next_action`).

5. **Check slug collision.** If `brain/tasks/{slug}.html` already exists, propose a disambiguated slug (`{slug}-2`, or `{slug}-<context>`).

6. **Write the page** at `brain/tasks/{slug}.html`. Body:

   ```html
   <article data-robin-doc>
     <h1>{Title from summary}</h1>
     <p>{Optional longer description.}</p>

     <h2>Acceptance</h2>
     <ul data-block="bulletList">
       <li>(Filled if --acceptance was provided; otherwise leave a stub.)</li>
     </ul>

     <h2>Notes</h2>
     <p>(Optional context.)</p>
   </article>
   ```

7. **Append to `logs/changelog.md`:**
   ```
   ## [YYYY-MM-DD] task | Created [[{slug}]] — {summary}
   ```

8. **Confirm to user:**
   ```
   Created [[{slug}]]
   - priority: {priority}
   - owner: {owner}
   - project: {project or "—"}
   - due: {due or "—"}
   ```

## Output shape

One short confirmation. The user should be able to glance and know the defaults were applied correctly.

## Edge cases

- **The "task" is actually a recurring habit.** Suggest a playbook (`brain/playbooks/`) instead.
- **The "task" is actually a project.** Suggest creating a project (`brain/projects/<slug>/`).
- **Slug collision.** Disambiguate with `-2` or a context suffix.
- **Invoked from `/ingest-meeting`.** The `source` field should be the meeting page path: `meeting:logs/meetings/YYYY-MM-DD-<slug>.html`.
- **Title doesn't translate to a clean slug.** Ask for a slug if auto-generation produces something awkward.

## Side effects

- Writes `brain/tasks/{slug}.html`.
- Appends to `logs/changelog.md`.
- Does NOT update `brain/tasks/_index.html` automatically (that's hand-curated for P0/P1 only).

## Notes

- **Use `status`, NOT `state`.** The task filter in `/check-tasks` and `/morning-brief` filters on `status`. A task with `state` is invisible.
- If your MCP has a `task.create` shortcut, that may hardcode `state:` (legacy) — prefer `page.create` with the full frontmatter above.
