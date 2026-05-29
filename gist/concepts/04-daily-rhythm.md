# 04 — The daily rhythm

A system that requires daily ritual fails. A system that *rewards* daily ritual compounds.

Robin's rhythm is three skills. They are independent — running one does not run the others. They run on their own triggers.

| Skill | When | Cost | Scope |
|---|---|---|---|
| `/morning-brief` | Start of day | ~30s | Calendar + tasks + comms + ritual blocks |
| `/check-tasks` | Mid-day, ad-hoc | <5s | Brain-only pulse on open work |
| `/remsleep` | End of day | Minutes | Multi-agent consolidation + reflection |

Plus one knowledge-promotion skill that runs *whenever it should*:

| Skill | When | Cost | Scope |
|---|---|---|---|
| `/learn` | Before `/compact`, or after any session producing durable insight | Seconds | Conversation-scoped knowledge promotion |

## `/morning-brief`

**Trigger:** start of day, manually invoked. (Some teams wire it to a calendar event or shell alias.)

**Cost:** ~30 seconds, dominated by MCP calls if calendar/email/Slack are connected.

**What it does:**

1. **Gathers** in parallel: today's calendar, current task health, recent Slack activity, inbox email.
2. **Surfaces** P0/P1 tasks, overdue/blocked items, last-night's reflection questions if any.
3. **Pre-prepares** up to two upcoming stakeholder/external meetings: pulls attendee pages, open tasks for those attendees, project background.
4. **Runs ritual blocks** that are gated `true` in `config.yaml`:
   - `self_reflection: true` — surfaces a reflection prompt every N days.
   - `weekly_review: true` — on Mondays, runs the `/weekly-review` orchestration.
   - `stakeholder_pulse: true` — flags people you haven't pinged in N+ days.
   - (others can be added freely)
5. **Writes** the brief to `logs/reports/YYYY-MM-DD-morning-brief.html` and emits a concise <50-line summary.

**What it does NOT do:** edit brain pages, create tasks, send messages. The brief is read-only and informational.

**Adapt:** every ritual block is a soft switch. Turn them on as your work calls for them. The skill ignores unknown flags.

## `/check-tasks`

**Trigger:** mid-day, when you need a fast re-orientation. Also called by `/morning-brief`.

**Cost:** <5 seconds. Brain-only — no external MCP calls.

**What it does:**

1. Reads `brain/tasks/*.html`.
2. Filters to active tasks (`status` in {open, in-progress, blocked}).
3. Groups by priority (P0/P1/P2/P3) and surfaces health flags:
   - Overdue (`due < today`).
   - Stale (`updated < today − 3d` for open/in-progress tasks).
   - Blocked without explanation.
   - P0/P1 without a `due:` date.
4. Reports last 5 changelog entries to remind you what's been moving.

**Quick mode (`--quick`):** ~20 lines max, reads `brain/tasks/_index.html` directly (the hand-curated rollup) instead of walking all task files. Use this when you want a pulse, not a full audit.

## `/remsleep`

**Trigger:** end of day. Sometimes weekly (for a deeper synthesis).

**Cost:** several minutes. Dispatches multiple sub-agents in parallel.

**Four phases:**

1. **Cleanup** — verifies `/lint-wiki` ran today; processes any unprocessed transcripts in `inbox/meetings/`; ingests browser annotations; enumerates today's `/learn` output.
2. **Replay** — reads today's conversation log + changelog + meetings + git activity. Extracts decisions, repeated topics, priority shifts, missed action items, new context about people/projects.
3. **Synthesis** — creates 1–2 new knowledge pages when patterns emerge. Links pages that should reference each other but don't. Reconciles hubs (scan last 7 days; flag missing entries and stale hubs). Detects repeated workflows that might deserve becoming a skill. Reviews `/learn` output: promotes `state: needs-review` → `state: stable` where solid; flags overlaps/conflicts.
4. **Reflection** — writes 3–5 targeted reflection questions to `brain/about_user/reflections/questions.html`. Daily mode: terse single-paragraph prompts. Weekly mode (Sundays/Mondays): deeper multi-paragraph prompts.

**Key design:** additive only. `/remsleep` never deletes. When facts conflict, it appends with a history marker (`(superseded YYYY-MM-DD by [[link]])`), preserving the chain.

**Hard precondition:** `/lint-wiki` must have run today. If it hasn't, `/remsleep` fails fast and asks you to run lint first. Curation on a broken vault doesn't make sense.

## `/learn`

**Trigger:** whenever you've decided something durable, or before `/compact`.

**Cost:** seconds. Synchronous. Conversation-scoped.

**What it does:**

1. Reviews the conversation for candidates:
   - Brain updates (new facts, decisions, status changes).
   - New knowledge pages (playbooks, patterns, standards, unknowns).
   - Tasks (commitments, follow-ups).
   - Memory events (preferences, corrections, source-of-truth notes).
   - Skill candidates (workflows you've now done 3+ times the same way).
2. Filters: durable? not already captured? specific enough to be retrievable?
3. Writes — to existing pages where possible, new pages where needed. New pages start `state: needs-review`.
4. Appends to `logs/changelog.md`: `## [YYYY-MM-DD] enrich | /learn — <topic>` with counts.
5. **Mandatory**: touches `logs/.last-learn` so the PreCompact hook knows `/learn` just ran.
6. Reports preserved/skipped.

**Anti-padding bias:** if nothing is genuinely durable, `/learn` says "nothing this session" and exits clean. Empty `/learn` runs are fine.

**Relationship to `/remsleep`:** `/learn` writes generously (`needs-review`). `/remsleep` curates (`needs-review` → `stable`). The split exists because in-session you don't know what's worth keeping; at end-of-day with context, you do.

## The PreCompact hook

LLM conversations get compacted (summarized into a shorter form) when context fills. Compaction destroys nuance.

The hook is a non-blocking nudge:

```
Before compaction starts:
  - check logs/.last-learn mtime
  - if /learn ran in past 30 min → quiet, proceed
  - else → print "Run /learn first to preserve durable knowledge." (exit code 2 in some shells = suggestion)
  - never block
```

The hook is *opt-in by suggestion*. If there's nothing durable, you proceed; the brain doesn't grow this session. That's fine. Most sessions don't need /learn.

## The rhythm in practice

A normal day:

```
08:30  /morning-brief             →  read it, plan the day
09:00  …work…
11:30  /check-tasks --quick       →  re-orient between contexts
14:00  …work…
17:00  /learn                     →  promote durable insights
17:05  (sometimes) /compact        →  the hook nudges you if /learn skipped
17:30  /remsleep                  →  end-of-day consolidation
```

You can skip days. The system doesn't require constant attention. Skip too many and the brain stops compounding.

## What rhythm does NOT mean

- **Not strict cadence.** Some days you skip morning-brief because the day starts with a known plan. Some days you run /remsleep mid-afternoon because you're stopping early. Adapt.
- **Not auto-execution.** None of these skills run on a cron. You invoke them. Side effects on session state are valuable; auto-running them creates noise.
- **Not surveillance.** `/remsleep` looks at *your own* activity (git, brain edits, conversation log). It does not snoop on your team. Comms surfaces (Slack/email) only show what you've already chosen to receive.

## Adapting the rhythm

`.claude/constitution/daily-rhythm.md` defines the triad. To add a fourth ritual:

1. Decide what the trigger is. Daily? Weekly? On a date condition?
2. Decide what it surfaces. Tasks? Comms? Reflection?
3. Add a flag in `config.yaml`.
4. Wire it into `/morning-brief` if it should be surfaced there.
5. Add it as a separate skill if it's heavy enough to run standalone.

The rhythm is a starter pattern. Make it yours over the first month. Most users add 1–2 personal rituals after a few weeks.

Continue: [`05-two-memory-layers.md`](./05-two-memory-layers.md).
