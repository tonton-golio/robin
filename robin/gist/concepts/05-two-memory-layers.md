# 05 — Two memory layers (actually three)

Memory is the one design decision people get wrong. Reading this short doc carefully will save you a lot of confusion later.

## The three layers

Robin actually has **three** distinct memory layers, each with a different purpose:

| Layer | Where it lives | Format | What goes here |
|---|---|---|---|
| **Brain pages** | `brain/<area>/<slug>.html` | HTML with `<meta name="robin:*">` | Entities and durable knowledge: projects, people, decisions, patterns, playbooks |
| **Brain memory events** | `brain/memory/events.jsonl` | JSONL, append-only | Compact recall: preferences, corrections, source-of-truth notes, small dated facts |
| **Agent auto-memory** | Outside the repo (e.g., `~/.claude/projects/<encoded-path>/memory/`) | Markdown files with frontmatter | How the agent should work with *this* user: tool preferences, repo conventions, working agreements |

Each serves a fundamentally different purpose. Mixing them is the most common mistake.

## Layer 1: brain pages

Use when the thing **has identity**.

Examples:

- A project (has goals, owner, lifecycle).
- A person (has role, context, history).
- A decision (has rationale, alternatives, supersession chain).
- A pattern (recurring approach you want to name and reference).
- A playbook (step-by-step procedure).

If you'd say "let me tell you about X" and need more than two sentences — it's a page.

Pages live forever (until you archive them). They get linked, indexed, surfaced in `/morning-brief`, audited by `/lint-wiki`. They are the primary durable surface.

## Layer 2: brain memory events

Use when the thing is **a recall cue** — something you'd want the agent to remember next session but doesn't deserve its own page.

Examples:

- "We costs in EUR, not USD." (preference)
- "The translation channel is `#proj-translations`, not `#translation`." (correction)
- "We work on main in this repo; no feature branches." (working rule)
- "Verify task status against the repo before trusting it — the task page drifts behind the code." (source-of-truth warning)

These are small. One or two sentences. They have a *type* (preference, correction, pattern, decision, etc.), a *scope* (global, a specific project, a specific repo), a *source* (where the knowledge came from), and a *lifecycle* (active, superseded, archived).

`brain/memory/events.jsonl` is append-only. Updates don't overwrite; they emit new events that supersede the old. The full schema is in [`../format/memory-events.md`](../format/memory-events.md).

The MCP search layer (or your agent's own logic) consults memory events early in retrieval — they're cheap to scan and high signal.

## Layer 3: agent auto-memory

Use when the thing is about **the agent itself**.

Examples:

- "When in this repo, commit straight to main."
- "Use Slack channel X for end-of-day standups."
- "Default to EUR when discussing costs."
- "Don't lecture me about untyped Python."

These are *working agreements between you and the agent*. They are not facts about the world. They live outside the repo because they belong to the agent (e.g., Claude Code's `~/.claude/projects/...` memory directory), not the project.

Auto-memory has its own schema (frontmatter-style files indexed by a `MEMORY.md`). Your agent's documentation describes it; this gist doesn't redefine it.

## The decision tree

```
You learn something. Where does it go?

├─ Is it about the agent's behavior toward you?
│  └─ YES → Agent auto-memory.
│
├─ Is it a small, compact recall cue (preference, correction, working rule, source-of-truth note)?
│  └─ YES → brain/memory/events.jsonl.
│
└─ Is it an entity or substantial knowledge that deserves elaboration?
   └─ YES → brain/<area>/<slug>.html.
```

If you're not sure, **err toward pages**. Pages are cheap to update; memory events are cheap to write. The cost of getting it wrong is small.

## The most common mistakes

### Mistake 1: putting working agreements in the brain

A user says "always work on main here." A confused agent writes a page at `brain/repos/this-repo.html` with that rule. Now the rule is buried in a page about the repo, not surfaced as a working agreement.

**Fix:** that's auto-memory. Save it where the agent reads it on every session.

### Mistake 2: putting recall cues in pages

A user corrects a fact: "we don't use Confluence anymore, we use Notion." A confused agent edits the most-recent project page to mention this.

**Fix:** that's a memory event. Type `correction`. Scope `global` (or scoped to the relevant project). One-line summary. The next time the agent searches, the correction surfaces before stale pages.

### Mistake 3: putting entities in memory events

The user introduces a new stakeholder. The agent writes a memory event: "new stakeholder named X joined the team."

**Fix:** that's a page. `brain/people/stakeholders/x.html`. Memory events are for cues, not biographies.

### Mistake 4: never promoting

The agent writes everything to memory events because it's "lighter." Three months in, the JSONL is huge, search is noisy, and substantive entities have no pages.

**Fix:** promote. If you find yourself referencing a memory event repeatedly, it deserves a page. `/remsleep` Phase 3 catches these and suggests promotion.

## How `/learn` and `/remsleep` interact with memory

- `/learn` *writes* to all three layers (or just one or two, depending on what's appropriate). It's generous.
- `/remsleep` *curates*:
  - Promotes `needs-review` pages to `stable`.
  - Surfaces overlap/conflict in memory events.
  - Flags entities sitting in memory events that probably deserve pages.
  - Never deletes; appends with history.

The constitution file `.claude/constitution/learning.md` codifies this.

## Practical advice for your first month

For the first 30 days, just **use pages**. Don't worry about memory events. Pages are forgiving — you can rewrite them.

Around day 30, you'll notice patterns of small recall cues that aren't worth a page but recur. Start using memory events for those.

Auto-memory is the lightest layer; the agent often writes it without you asking. Trust your agent's defaults here. If it captures something that bothers you, edit or delete the memory entry directly.

Continue: [`06-capture-pipeline.md`](./06-capture-pipeline.md).
