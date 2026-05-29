# 03 — Information architecture

The point of a taxonomy is **fast retrieval**. A future query should land on the right page in one hop. Robin's `brain/` layout is opinionated about where things go.

## The top-level directories

### `brain/projects/`

One folder per active workstream. Each project owns:

```
brain/projects/<project-slug>/
├── _index.html                  # Overview, current state, key links.
├── <project-slug>.html          # Main project page (same name as the folder).
├── features/                    # Subdivisions of work.
│   └── <feature-slug>.html
├── decisions/                   # Project-local decisions (or cross-link to brain/decisions/).
└── archive/                     # Completed work, moved here when project closes.
```

Use it for: anything that has an owner, a goal, and changes over time. Avoid for: short-lived experiments (those go in `unknowns/` or are captured as `decisions/`).

### `brain/people/`

Subdivided by relationship:

- `people/team/` — your direct reports, peers, anyone you work with daily.
- `people/stakeholders/` — partners, leadership, customers, external contributors.
- `people/candidates/` — historical hiring (mostly archived).

Each person is one file: `<first-last>.html` or `<nickname>.html` in kebab-case.

A person page carries: role, current focus, communication preferences, links to projects they touch, key dates (joined, milestones), recent meetings.

### `brain/decisions/`

Date-stamped decision records: `YYYY-MM-DD-<slug>.html`.

Why date-stamped: decisions are intrinsically tied to a moment. Old decisions get superseded; the timestamp lets you reconstruct the chain. Pages can reference earlier decisions explicitly via wikilinks.

A decision page has: what was decided, what was considered, what was rejected, why, who decided, what's downstream. Be explicit about supersession when a later decision changes an earlier one.

### `brain/patterns/`

Named recurring approaches you've recognized and want to remember. Examples (generic):

- `parallel-subagent-sweep.html` — dispatching multiple agents to scan a vault in parallel.
- `draft-first-vs-autonomous.html` — when to wait for confirmation vs. act directly.

Each pattern: when it applies, why it works, what to watch for, links to instances.

Patterns differ from playbooks: patterns are descriptive (this is a thing that happens), playbooks are prescriptive (here's how to do it).

### `brain/playbooks/`

Step-by-step procedures. Things you (or the agent) execute. Examples (generic):

- `onboarding-new-teammate.html`
- `quarterly-planning-cycle.html`
- `incident-response.html`

Each playbook: trigger, preconditions, steps, success criteria, known gaps.

### `brain/standards/`

The rules you've explicitly committed to. Examples (generic):

- `code-review-criteria.html`
- `meeting-notes-format.html`
- `hiring-rubric.html`

Standards differ from patterns: a pattern is "this happens"; a standard is "this is how we do it, and deviations need a reason." Standards have higher gravity.

### `brain/hubs/`

Thin, opinionated navigation pages for big recurring topics. Examples (generic):

- `llm-providers.html` — what providers exist, which we use for what, with one-line descriptions and wikilinks.
- `agent-frameworks.html`
- `data-pipelines.html`

A hub is **not authoritative**. It is a fast-lookup index. The substance lives in the linked pages.

Every hub ends with a `## Known gaps` section listing what's *not* yet covered. This enforces honest incompleteness. Hubs decay fast; reconcile them every two weeks.

### `brain/tasks/`

One file per open task. Frontmatter carries status, priority, due, owner, project.

A task is something that *should be acted on*. Not "we're tracking X" (that's a project page or hub) and not "we noticed X" (that's a memory event).

Tasks move through states: `open → in-progress → done`, with side states for `blocked`, `dropped`, `superseded`, `cancelled`.

A separate `workflow:` field tracks queue position: `inbox → next → active → waiting → review → scheduled → backlog`.

Move done tasks older than ~14 days to `tasks/archive/` to keep the active set scannable.

### `brain/memory/`

Just `events.jsonl` (append-only) plus an `_index.html` describing its purpose.

The JSONL is for *compact recall* — preferences, corrections, source-of-truth warnings, small dated facts. It is NOT a replacement for canonical pages. If something deserves a paragraph, write a page.

See [`05-two-memory-layers.md`](./05-two-memory-layers.md) for the boundary.

### `brain/strategy/`

Long-term plans, scorecards, roadmaps. Pages here often pull from `projects/` and `decisions/` to compose a coherent story. They get re-cut periodically.

### `brain/repos/`

If your work touches multiple code repositories, register them here. One file per repo: where it lives, what it does, key files, deployment notes. The page is a *bridge* between durable knowledge (which lives here) and the live repo (which has its own README, AGENTS.md, etc.).

### `brain/tools/`

Internal tools, infrastructure, services you operate. One page per tool. Owners, links, runbooks, current state.

### `brain/unknowns/`

Open questions worth tracking. Things you haven't decided on yet. Each unknown carries: the question, why it matters, what would resolve it, who owns chasing it down.

When an unknown is resolved, archive it (often with a link to the resulting decision).

### `brain/annotations/`

Highlights, comments, or pin-style annotations made while reading brain pages. If your reading tool can export annotations as JSONL, this is where they land before being processed. Treat as transient — they get rolled up into memory events or page edits, then archived.

### `brain/work-log/`

Append-only monthly logs of work done. One file per month (`2026-05.html`, `2026-06.html`). Entries: what you did, decisions reached, blockers hit. Used by the agent during `/remsleep` for trend detection and reflection.

### `brain/about_user/`

Personal context about the primary user the agent is collaborating with. Examples:

- `communication-style.html` — how you like to be talked to.
- `values.html` — what you optimize for.
- `working-hours.html` — when you're available; how the agent should think about urgency.
- `known-blindspots.html` — patterns the agent should watch for and push back on.
- `reflections/` — durable reflection capture (gated by `self_reflection:` config).

Treat this as the agent's personal field guide. The more honest, the better.

## The `_index.html` discipline

Every directory and most subdirectories have an `_index.html`. Three roles:

1. **Orientation for new agent sessions.** The first thing a new session reads after `CLAUDE.md` is `brain/_index.html`. It should describe the layout and link to current focus areas.
2. **Navigation for humans.** Browse the brain in a browser; index pages make that pleasant.
3. **Backstop for hubs.** An `_index.html` is the implicit hub for its directory.

Update `_index.html` whenever you:
- Add or remove a subdirectory.
- Add a new project, person, or hub of note.
- Restructure the topic mix in a directory.

## The hub pattern in detail

A hub is a *thin* page (often under 100 lines of HTML) with structure:

```
## Section name (e.g., "In production")
- **<Entity>** (<one-line context>) — <opinionated description> · [[link]] · [[link]]

## Another section (e.g., "Candidate signal")
...

## Legacy
...

## Known gaps
- We haven't yet evaluated X.
- Comparison between Y and Z is missing.
```

Hubs are *opinionated*. They state what's used, what's being evaluated, what's been retired. They are not exhaustive directories. If two hubs cover overlapping ground, merge them.

## Naming conventions

- **Slugs:** kebab-case, lowercase, no spaces. `agent-frameworks`, `2026-04-17-board-prep`.
- **Page filenames:** `<slug>.html`.
- **Date-stamped pages:** `YYYY-MM-DD-<slug>.html`.
- **Index pages:** `_index.html`.
- **Archive subfolder:** `archive/` (lowercase, always present in long-lived directories).

Slugs **need not be globally unique** — pages are identified by their vault-relative path. But unambiguous slugs help wikilinks resolve cleanly. If two pages need the same slug, prefer renaming one.

## The placement test

Before creating a new page, ask:

1. **Does a page already exist for this?** Search. Updating beats creating. Duplicates fragment recall.
2. **What kind of entity is this?** Project → `projects/`. Person → `people/`. Decision → `decisions/`. Recurring approach → `patterns/`. Rule → `standards/`. Procedure → `playbooks/`. Open question → `unknowns/`.
3. **Is it small?** If it's a one-line fact or a working agreement, it might belong in `brain/memory/events.jsonl` instead of a page.
4. **Is there a hub?** If 3+ scattered references already exist, create or update a hub.

Get the placement right at creation time. Moving pages later is cheap (slugs are stable) but costly to attention.

Continue: [`04-daily-rhythm.md`](./04-daily-rhythm.md).
