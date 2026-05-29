---
name: remsleep
description: End-of-day multi-phase consolidation. Cleanup, replay, synthesis, reflection. Surfaces patterns the user wouldn't catch in real-time.
---

# /remsleep

## Purpose

Close the day by reviewing what happened, promoting knowledge that's now solid, reconciling hubs, and writing reflection prompts. Multi-phase, dispatches sub-agents for parallel work.

## When to use

- End of day. Manually invoked.
- Weekly variant: Sunday or Monday morning (deeper synthesis).

## Hard preconditions

- **`/lint-wiki` must have run today.** If it hasn't, fail fast and ask the user to run lint first. Curation on a broken vault is wrong.

## Arguments

- `--weekly` (optional) — deeper synthesis mode for end-of-week. Reads a 7-day window instead of 1-day.
- `--for=<YYYY-MM-DD>` (optional) — run as if today were that date. Useful for catching up on a missed day.

## Phases

The skill runs four phases. Phases 1–3 can dispatch sub-agents in parallel; Phase 4 runs after.

### Phase 1 — Cleanup

1. Verify `/lint-wiki` ran today. If not, halt with a clear error.
2. Scan `inbox/meetings/` for unprocessed transcripts (files not in `inbox/archived/`). If any, invoke `/ingest-meeting` for each.
3. Scan any annotation sources (`inbox/<tool>/annotations/YYYY-MM.jsonl`) for unresolved annotations. If any, invoke `/ingest-source annotations`.
4. Enumerate today's `/learn` output by reading entries dated today in `logs/changelog.md` (look for `[YYYY-MM-DD] enrich | /learn` headers). Collect the set of pages, tasks, and memory events touched.

### Phase 2 — Replay (sub-agent)

Dispatch a sub-agent to investigate today's activity, in parallel:

- Read today's `logs/changelog.md` entries.
- Read any meeting summaries in `logs/meetings/` dated today.
- Read git activity for any repos under `repos/` (last 24 hours).
- Read today's `logs/daily/YYYY-MM-DD.md` if present.

The sub-agent extracts:
- Decisions made (explicit or implicit).
- Repeated topics.
- Priority shifts.
- Missed action items.
- New context about people / projects / tools.

Return a structured summary to the orchestrator.

### Phase 3 — Synthesis (sub-agent)

Dispatch a sub-agent to do the curation work:

1. **Review `/learn` output from Phase 1.** For each `needs-review` page touched today:
   - Is it well-linked? (Search for backlinks.)
   - Is it substantive (not a stub)?
   - Does it overlap with an existing page?
   - Recommend: keep at `needs-review` / promote to `stable` / merge with `[[other-page]]` / archive.

2. **Hub reconciliation.** Scan the last 7 days of activity for entities (tools, vendors, frameworks, projects) that should be on a hub but aren't. For each gap:
   - Suggest the hub to update.
   - Suggest the entry text.
   - Flag hubs with `robin:last_reconciled` older than 14 days.

3. **Skill candidate detection.** Walk Phase 2's output for workflows the user did 3+ times the same way. Flag (do NOT auto-create) as skill candidates with brief description.

4. **Long-range link suggestions.** Identify pages that *should* reference each other but don't (e.g., a new decision that references a project — the project page should link the decision).

5. **Conflict surfacing.** Identify cases where `/learn` produced a fact that conflicts with an existing fact. Recommend append-with-history (NEVER auto-resolve).

Return a curation report.

### Phase 4 — Reflection

Compose reflection prompts and write to `brain/about_user/reflections/questions.html`. Behavior depends on `self_reflection:` config and mode:

- **`self_reflection: false`** → skip Phase 4 entirely.
- **`self_reflection: true`, daily mode** → 1 terse question for tomorrow morning. One paragraph max.
- **`self_reflection: true`, weekly mode** → 2–3 deeper questions. Multi-paragraph context for each.

Prompts are *targeted* — they reflect the day's actual content (decisions, conflicts, tensions noted in Phase 2). Generic prompts are not useful.

Append to the questions file (don't overwrite — keep history).

## Compose the report

After all phases:

1. Write `logs/remsleep/YYYY-MM-DD.html` (Robin v0.2, `robin:type=remsleep`, `robin:date=YYYY-MM-DD`). The report includes:
   - Phase 1: cleanup summary.
   - Phase 2: today's replay (decisions, priorities, etc.).
   - Phase 3: curation recommendations (with the user's decision pending for promotions/merges).
   - Phase 4: reflection prompts written (link to questions file).

2. Append to `logs/changelog.md`:
   ```
   ## [YYYY-MM-DD] remsleep | <one-line summary>
   ```

3. Emit a compact summary in chat:
   - What was cleaned up.
   - Key replay findings.
   - Curation recommendations awaiting confirmation.
   - Reflection prompt(s) written.

## Constraints

- **Additive only.** Never delete. When facts conflict, append with history markers.
- **Suggest, don't decide.** Promotion candidates surface for user decision (or, if user has explicitly authorized auto-promotion of well-linked pages, act — but never silently delete or merge).
- **Provenance preserved.** Every change writes a `robin:source` if the change came from a specific source.
- **Multi-agent.** Use sub-agents for Phases 2 and 3 to keep the main context light.

## Output shape

The chat summary is concise (under 30 lines). The full report is in `logs/remsleep/YYYY-MM-DD.html` and the chat summary links to it.

## Edge cases

- **No activity today.** Run anyway. Phase 1 may have annotation work to do. Phase 4 can still produce a prompt. Output reflects the quiet day.
- **`/lint-wiki` not run.** Halt with a clear instruction: "Run `/lint-wiki` first."
- **Conflicts surface.** Surface them. The user resolves; never auto-merge.
- **Skill candidate detected but uncertain.** Flag with low confidence. The user decides whether to promote to a skill.
