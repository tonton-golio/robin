---
name: learn
description: Preserve durable knowledge from the current conversation before context compaction or any time durable insight has surfaced. The single most important skill in the rhythm.
---

# /learn

## Purpose

Promote durable knowledge from the current conversation into the brain (`brain/`), the memory event stream (`brain/memory/events.jsonl`), or the agent's auto-memory — whichever is appropriate.

This is the gateway from session context to durable storage. It is what makes the second brain *grow* instead of just exist.

## When to use

- **Before `/compact`.** The PreCompact hook will nudge you if `/learn` hasn't run in the past 30 minutes.
- **After any session that produced** a decision, a new fact, a synthesis, a new pattern, a new task, a working agreement.
- **Whenever the conversation "would be a shame to lose."**

Empty `/learn` runs are fine — if nothing durable surfaced, the skill says so and exits. **Anti-padding bias is the rule:** never invent durable knowledge to pad output.

## Steps

1. **Review the conversation.** Scan from the most recent context backward. Look for candidates in these buckets:
   - **Brain updates** — new facts about an existing entity (person, project, decision, tool, etc.) that aren't yet captured. Update the relevant page.
   - **New pages** — entities that deserve their own identity but don't have a page yet (a new pattern, a new playbook, a new standard, a new decision, a new unknown).
   - **Tasks** — commitments or follow-ups from this session. Route via `/create-task`.
   - **Memory events** — small recall cues: preferences, corrections, source-of-truth notes, working rules. Append to `brain/memory/events.jsonl` via the appropriate memory.save mechanism. See [`../../format/memory-events.md`](../../format/memory-events.md).
   - **Auto-memory** — working agreements between user and agent. Write to the agent's session-persistent memory store (not in this repo).
   - **Skill candidates** — workflows you've done manually 3+ times the same way. **Flag, don't auto-create.**

2. **Filter.** For each candidate, ask:
   - Is it **durable** (will matter next week)?
   - Is it **not already captured** (search before creating)?
   - Is it **specific** enough to be retrievable later?

   Drop candidates that fail any of these.

3. **Write to the right layer.** See [`../../concepts/05-two-memory-layers.md`](../../concepts/05-two-memory-layers.md):
   - Substantial entity → brain page.
   - Compact recall cue → memory event.
   - Agent-behavior agreement → auto-memory.

4. **Provenance.** Every new durable claim carries a source. See [`../lib/provenance.md`](../lib/provenance.md). For conversation-sourced knowledge, the source is `conversation:session-{{DATE}}`.

5. **State: needs-review.** New pages start at `<meta name="robin:state" content="needs-review">`. `/remsleep` Phase 3 promotes solid pages to `stable` later.

6. **Append to changelog.** Add an entry to `logs/changelog.md`:
   ```
   ## [YYYY-MM-DD] enrich | /learn — <one-line topic>

   - Updated [[page-slug]] with <what changed>.
   - Created [[new-page-slug]] (state: needs-review).
   - Saved memory event: <subject>.
   - Created task [[task-slug]].
   - Skill candidate flagged: <workflow>.
   ```

7. **Touch the sentinel.** Run `touch logs/.last-learn`. The PreCompact hook checks this file's mtime; if `/learn` ran in the past 30 minutes, the hook stays quiet. **This step is mandatory.**

8. **Report.** Summarize for the user:
   ```
   Preserved:
   - Brain updates: N
   - New pages: N (state: needs-review)
   - Tasks: N
   - Memory events: N
   - Skill candidates flagged: N

   Skipped: (brief notes on what you considered but didn't preserve)
   ```

## Output shape

Concise. The user shouldn't have to read the changelog to understand what was preserved. One or two screens max.

## Edge cases

- **Nothing durable.** Say so: "Nothing this session." Still touch `logs/.last-learn`.
- **The conversation is huge.** Don't try to capture everything. Aim for high-signal items only. Coverage isn't the goal; durability is.
- **You're unsure about a candidate.** Lean toward capturing as a memory event (cheaper than a page). `/remsleep` Phase 3 will surface it for promotion later.
- **A candidate conflicts with existing knowledge.** Use append-with-history (see [`../../templates/constitution/learning.md`](../../templates/constitution/learning.md)). Never overwrite silently.

## What `/learn` is NOT

- It's not `/remsleep`. `/learn` is in-conversation, fast, generous. `/remsleep` is end-of-day, slow, curating.
- It's not a transcript dump. It's a *filter*.
- It's not perfect. It's good enough. `/remsleep` cleans up.
