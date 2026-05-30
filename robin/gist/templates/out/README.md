# out/

**Polished artifacts for humans outside the system.**

## What goes here

Things you ship to people: stakeholders, the board, customers, teammates getting onboarded.

- **`out/plans/`** — planning documents, roadmaps.
- **`out/presentations/`** — slide decks.
- **`out/reports/`** — written reports, post-mortems, briefs for external audiences.

## Conventions

- **HTML only** (same format as `brain/` — see `format/page-format.md`).
- **Carries Robin metadata:** `robin:type=brief` / `report` / `plan`, `robin:state=draft` / `final`, `robin:date=<when it was issued>`.
- **Composed from `brain/`.** Artifacts derive from durable brain content. Update the brain; re-cut the artifact.
- **Audience-tailored.** Polished, styled, narrative. Different from brain pages, which are terse and well-linked.

## How `out/` differs from `brain/`

| | `brain/` | `out/` |
|---|---|---|
| Audience | You + agent | External humans |
| Style | Terse, well-linked | Polished, narrative |
| Lifecycle | Living, edited iteratively | Snapshot when shipped |
| Format | Robin HTML | Robin HTML (often with extra CSS) |
| Provenance | `robin:source` to inbox files | `robin:source` to brain pages it derives from |

Don't conflate them. A board deck in `brain/` muddles the brain. A team retro note in `out/` is invisible to your agent.

## When to ship from `out/`

When you need to share something with someone outside the system. Until then, the artifact lives in your brain (`brain/strategy/`, `brain/projects/<slug>/`).

`out/` is the layer where presentation, framing, and audience-tailoring matter. Don't pre-build `out/` artifacts that nobody is going to read. Compose on demand from the brain.
