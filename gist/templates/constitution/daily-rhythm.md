# Daily rhythm

The system runs on three skills. They are **independent** — running one does not run the others. Each has its own trigger, cost, and scope.

| Skill | When | Cost | Scope |
|---|---|---|---|
| `/morning-brief` | Start of day | ~30s, MCP calls | Calendar, tasks, comms, ritual blocks |
| `/check-tasks --quick` | Mid-day, ad-hoc | <5s, brain only | Tasks grouped by priority + last 5 changelog entries |
| `/remsleep` | End of day | Minutes, multi-agent | Cleanup ‖ replay ‖ synthesis → reflection |

Plus an out-of-rhythm preservation skill:

| Skill | When | Cost | Scope |
|---|---|---|---|
| `/learn` | Before `/compact`, or any session producing durable insight | Seconds | Conversation-scoped knowledge promotion |

## `/morning-brief`

**Trigger:** start of day. Sometimes earlier; sometimes after the first cup of coffee. {{USER_NAME}} invokes it manually.

**What it does:**

1. **Gather in parallel.** Calendar (today), tasks (active set), Slack (mentions, primary channels), email (inbox triage).
2. **Surface needs-attention.** P0/P1, overdue, blocked-without-explanation.
3. **Pre-prepare upcoming meetings.** Up to 2 stakeholder/external meetings get an inline prep block: attendee page, open tasks for that attendee, project background.
4. **Run ritual blocks** gated `true` in `config.yaml`:
   - `self_reflection: true` — surface last night's reflection question (if today is a reflection day).
   - `weekly_review: true` — on Mondays, invoke `/weekly-review` after the brief.
   - `stakeholder_pulse: true` — flag stakeholders not pinged in N+ days.
   - (others — add freely)
5. **Write the brief** to `logs/reports/YYYY-MM-DD-morning-brief.html`.
6. **Emit** a concise <50-line summary.

**Boundaries:**

- Read-only. Does not edit brain pages or create tasks.
- Skips ritual blocks whose flag is `false` or absent.
- If an MCP isn't connected (no Slack, no Calendar), it skips that source silently.

## `/check-tasks --quick`

**Trigger:** mid-day, ad-hoc. When {{USER_NAME}} needs a fast re-orientation.

**What it does:**

1. Read `brain/tasks/_index.html` (the hand-curated rollup).
2. Show priority groupings (P0/P1) with one-line entries.
3. Append the last 5 entries from `logs/changelog.md`.
4. Output ~20 lines max.

Brain-only. No external calls. <5 seconds.

The full `/check-tasks` (without `--quick`) walks all task files, computes health flags, and reports overdue / stale / blocked. Use for deep audits; use `--quick` for daily pulses.

## `/remsleep`

**Trigger:** end of day. {{USER_NAME}} invokes it. Sometimes mid-afternoon for short days; sometimes Sunday for a weekly synthesis.

**Hard precondition:** `/lint-wiki` must have run today. If it hasn't, `/remsleep` fails fast and asks for lint first. Synthesis on a broken vault is wrong.

**Four phases:**

### Phase 1 — Cleanup

- Verify `/lint-wiki` ran today.
- Process any unprocessed transcripts in `inbox/meetings/`.
- Ingest browser annotations from `inbox/<tool>/annotations/`.
- Enumerate today's `/learn` output (pages created/updated, tasks, memory entries).

### Phase 2 — Replay

- Read today's conversation log, `logs/changelog.md` (today's entries), meeting summaries, git activity.
- Extract: decisions made, repeated topics, priority shifts, missed action items, new context about people/projects.

### Phase 3 — Synthesis

- Create 1–2 knowledge pages when patterns emerge.
- Link pages that should reference each other but don't.
- Reconcile hubs: scan last 7 days for entities that belong on hubs but aren't there.
- Detect repeated workflows (3+ manual repetitions = candidate skill).
- Review `/learn` output: promote solid `needs-review` → `stable`. Flag overlaps.

### Phase 4 — Reflection

- Write 3–5 targeted reflection questions to `brain/about_user/reflections/questions.html` (gated by `self_reflection: true`).
- Daily mode: terse single-paragraph prompts.
- Weekly mode (Sunday/Monday): deeper multi-paragraph prompts.

**Constraints:**

- **Additive only.** Never deletes. Append-with-history when facts conflict.
- **Suggest, don't decide.** Promotion candidates are surfaced for {{USER_NAME}} to ratify (or for the agent to act on if explicitly authorized).
- **Multi-agent.** Phases 1–4 may dispatch sub-agents (Sonnet/Haiku) to keep main-context light.

## `/learn`

**Trigger:** before `/compact`, or whenever the conversation produced durable insight.

**What it does:**

1. Scan the conversation for candidates: brain updates, new pages, tasks, memory events, skill candidates.
2. Filter: durable? not already captured? specific?
3. Write — to existing pages where possible, new pages where needed.
4. Append to `logs/changelog.md`.
5. Touch `logs/.last-learn` (mandatory — the PreCompact hook reads this).
6. Report preserved / skipped.

**Anti-padding bias.** If nothing is durable, `/learn` says so and exits clean. Empty runs are fine.

## Independence

The three skills are independent. Each can be invoked alone:

- You can run `/morning-brief` without running `/remsleep` last night.
- You can run `/check-tasks` without anything else.
- You can run `/remsleep` even if you skipped `/learn` mid-day (`/remsleep` Phase 1 catches up).

The skills compose because they share a brain. They don't compose by sequencing.

## Adapting the rhythm

The triad is the load-bearing core. Other rituals (weekly review, self-reflection, stakeholder pulse) are gated in `config.yaml` — turn on what fits, leave the rest off.

If you find yourself wanting a new ritual:

1. Add a flag in `config.yaml`.
2. Either wire it into `/morning-brief` (if it's a daily nudge) or build a standalone skill (if it's heavy).
3. Document the trigger and cost in this file.

Don't add rituals to soothe anxiety. Add them when they unlock work you couldn't do without them.

## Skipping

You can skip days. The system is robust to gaps.

What breaks if you skip too long:

- Brain hubs go stale (>14 days since `last_reconciled` triggers a lint warning).
- Tasks accumulate (you'll wade through a backlog).
- Insights from past sessions degrade (the conversation is gone).

The brain itself doesn't break. It just stops compounding. Pick up where you left off.
