# Learning — continuous knowledge promotion

You are constantly learning. This file describes how to capture, where to put it, and how to keep the brain coherent over time.

## Default to learning

During normal work, scan the conversation for promotion candidates:

- **Decisions** made (or implicitly made).
- **New facts** {{USER_NAME}} mentioned that aren't yet captured.
- **Syntheses** — patterns spanning multiple conversations.
- **Terms / acronyms** {{USER_NAME}} used in a domain-specific way.
- **Working agreements** (these go to *auto-memory*, not the brain).

You do not need to wait for an explicit "save this." If you notice it, log it.

## Scratch → durable promotion

Knowledge often starts rough:

1. **Captured in-conversation.** You hold the thought as it surfaces.
2. **Captured in `inbox/`.** If a source produces durable insight.
3. **Promoted to `brain/`.** When the insight stabilizes into a durable entity or rule.

Promotion is what `/learn` does. It is the explicit gateway from session-context to durable knowledge.

## Memory placement

Three layers — pick the right one. (See also [`../concepts/05-two-memory-layers.md`](../../concepts/05-two-memory-layers.md).)

| If it's… | …it goes to |
|---|---|
| An entity worth more than two sentences | `brain/<area>/<slug>.html` (a page) |
| A small recall cue, preference, correction, dated fact, source-of-truth note | `brain/memory/events.jsonl` (a memory event) |
| A working agreement between you and {{USER_NAME}} (how you should act) | Agent auto-memory (off-repo) |

**Common error:** putting working agreements in brain pages, or biographies in memory events. Re-read the decision tree until it's automatic.

## Update beats forking

Before creating a new page, **search** for an existing one. Duplicate pages fragment recall. Even when the topic overlaps only partially, updating an existing page is usually better than forking.

When you must fork (e.g., a sub-project deserves its own page), link both directions and keep the parent page lightweight.

## State and confidence

Every knowledge page carries a `robin:state`:

| State | When |
|---|---|
| `needs-review` | Default for newly written. Not yet vetted. |
| `stable` | Reviewed and kept. Well-linked. The everyday trust level. |
| `canonical` | Rare. Source-of-truth pages: core standards, key decisions, identity facts. |

`/learn` writes generously at `needs-review`. `/remsleep` Phase 3 promotes solid pages to `stable`. Promotion to `canonical` is {{USER_NAME}}'s call — surface candidates, don't bump silently.

## When facts conflict — synthesizer mode

Never overwrite a prior fact silently.

When a new fact contradicts an old one:

1. **Keep the old fact** with its original date.
2. **Append a marker:** `(superseded YYYY-MM-DD by [[link-to-new-context]])`.
3. **Add the new fact** with the new date.

This append-with-history discipline keeps the trail readable. Future-you can reconstruct how the understanding evolved.

Memory events use the same discipline at the JSONL layer: a `memory.resolved` event marks the old memory as `superseded`, the new memory's `supersedes` array references the old.

## Memory events vs. page promotion

A memory event is a small, fast-recall cue. A page is a substantial entity.

When you find yourself referencing the same memory event repeatedly, **promote it to a page**. The page becomes the canonical surface; the memory event can stay (it's a fast surface) but the page is now the depth.

`/remsleep` Phase 3 flags repeated-reference memory events as promotion candidates.

## No automatic exit ceremony

Sessions don't have a built-in "save the conversation" moment. Consolidation is `/remsleep`'s job, not the session's.

You can run `/learn` mid-session (especially before `/compact`) to preserve durable knowledge before the context window compresses. That's what the PreCompact hook nudges.

## `/learn` discipline

When you run `/learn`:

- **Scan**, don't dump. Pick durable candidates, filter out chatter.
- **Anti-padding:** if nothing is genuinely durable, say so. Empty `/learn` runs are fine.
- **Write to the right layer:** pages for entities, memory events for recall cues, auto-memory for working agreements.
- **State: needs-review** by default for new pages.
- **Provenance:** include `> Source: conversation YYYY-MM-DD` (or the relevant source) in the body, plus `<meta name="robin:source" …>` in `<head>`.
- **Log it:** append to `logs/changelog.md`.
- **Touch the sentinel:** `touch logs/.last-learn`.

## `/remsleep` Phase 3 (synthesis) — curation

End-of-day, `/remsleep` does what in-session `/learn` cannot:

- Reads the day's `/learn` output (the changelog entries) and considers what to promote.
- Surfaces overlaps and near-duplicates (no auto-merge — provenance matters).
- Reconciles hubs: scans the last 7 days for entities that should be on a hub but aren't.
- Detects skill candidates: workflows you've done manually 3+ times.

Phase 3 *suggests*. It doesn't silently rewrite the brain.

## Anti-patterns

- **Capturing too eagerly.** Not every sentence is durable. Pad the brain and signal-to-noise drops.
- **Capturing too cautiously.** Not capturing creates re-discovery tax. Err generous within reason.
- **Forking on minor disagreement.** Two pages for "the X project" because the second mention had different framing → terrible. Merge.
- **Letting `needs-review` accumulate forever.** A page that's been `needs-review` for two months is either bad knowledge or knowledge nobody trusts. Either fix it or archive it.
