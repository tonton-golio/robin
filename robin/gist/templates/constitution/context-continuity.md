# Context continuity

LLM conversations have a finite context window. When the window fills, the conversation is **compacted** — compressed into a shorter summary. Compaction destroys nuance.

The mechanisms below bridge that destruction: `/learn` promotes durable knowledge before compaction; the `.last-learn` sentinel coordinates with the PreCompact hook; `/remsleep` curates afterward.

## `/learn` before `/compact`

**Rule:** when you have produced durable knowledge in the current session, run `/learn` *before* `/compact`.

When to use `/learn`:

- Before `/compact`.
- After a session that produced a decision, a new fact, a synthesis, a new pattern, a new task, a working agreement.
- Whenever the conversation "would be a shame to lose."

What `/learn` does:

- Scans the conversation for promotion candidates.
- Writes to brain pages and memory events.
- Appends to `logs/changelog.md`.
- **Touches `logs/.last-learn`** (mandatory — this coordinates with the hook).

## The `.last-learn` sentinel

The file `logs/.last-learn` is a zero-byte sentinel. Its only meaningful property is its `mtime` (modification time). `/learn` touches it on completion. The PreCompact hook reads it.

## The PreCompact hook

If `.claude/hooks/` includes the PreCompact hook (a script run before context compaction), it checks `.last-learn` and behaves like:

```bash
if [ -f "$VAULT/logs/.last-learn" ]; then
  mtime=$(stat -f %m "$VAULT/logs/.last-learn")
  now=$(date +%s)
  if [ $((now - mtime)) -lt 1800 ]; then
    exit 0  # /learn ran in past 30 min — proceed quietly
  fi
fi
echo "Reminder: run /learn before /compact to preserve durable knowledge." >&2
exit 2  # non-blocking suggestion in most harnesses
```

The hook is a **nudge**, not a gate. If `/learn` has nothing to capture, it can still touch `.last-learn` (empty `/learn` is fine) — but the hook is also tolerant of skipping. If {{USER_NAME}} chooses to `/compact` without `/learn`, nothing breaks; durable knowledge from this session may just be lost.

## What survives compaction

- **Files on disk.** The brain is durable. `/compact` doesn't touch `brain/`, `inbox/`, `logs/`, `out/`.
- **The summary.** `/compact` writes a compact summary that survives the compaction.
- **Auto-memory.** The agent's session-persistent memory (off-repo) is unaffected.

## What doesn't survive

- **Conversational nuance.** Hedging, side-comments, intermediate reasoning. Gone.
- **Implicit decisions.** If a decision was made but never written, it dies.
- **Working state.** Half-written drafts in the chat, ad-hoc clarifications. Compressed into "we discussed X."

## `/remsleep` curates after

End of day, `/remsleep` reviews what `/learn` produced (via `logs/changelog.md` entries) and decides what to promote, link, or flag. Phase 1 (cleanup) lists `/learn` output. Phase 3 (synthesis) does the curation.

This division means `/learn` writes generously without worrying about perfection (curation happens later) and `/remsleep` curates without re-reading the conversation (the changelog tells the story).

## When to skip `/learn`

If nothing durable happened — purely exploratory chat, looking something up, troubleshooting an error — `/learn` is unnecessary. It will say "nothing to preserve" and exit clean.

The signal that `/learn` is unnecessary: you can't name a single new fact or decision the session produced.

## When `/compact` is forced

In long sessions, the harness may auto-compact when context fills. You may not get a chance to `/learn` first.

In that case:

- Acknowledge what was lost.
- Open a new session.
- Reconstruct the missing knowledge from your memory, the conversation summary, and any files that *did* get written.
- Write `/learn`-style entries into the brain to recover.

This is the worst case. Avoid it by running `/learn` proactively when the conversation has produced anything durable.

## Practice

You don't need to remember any of this. Just follow these heuristics:

1. **Decided something?** Run `/learn` before continuing or compacting.
2. **PreCompact hook reminded you?** Run `/learn`. (Or override deliberately.)
3. **End of day?** Run `/remsleep`. (Which depends on `/learn` having been run.)

The system is forgiving. Skipping one step doesn't break anything. Skipping enough steps lets the brain drift.
