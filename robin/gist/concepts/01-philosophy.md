# 01 — Philosophy

Robin is not a tool. It is a **pattern** for how a human and an AI agent share a durable workspace.

The pattern has five anchors. If you understand these, you can rebuild the rest.

## 1. The agent has finite memory; the brain is durable

LLM conversations have a finite context window. Compaction destroys nuance. Every "what were we talking about?" is a tax on momentum.

The fix is not to extend context. The fix is to **promote** knowledge out of the conversation and into a persistent store the agent can re-read. Robin's `brain/` folder is that store. Sessions come and go. The brain remains.

Implication: the agent's first reflex on encountering a durable insight is *write it down in the brain*, not *remember it for now*.

## 2. HTML is the durable form; Markdown is input

Most second-brain systems use Markdown because humans like writing it. Robin flips the assumption: Markdown is **authoring**, HTML is **storage**.

Why:

- HTML carries structured metadata via `<meta name="robin:*">` tags. Markdown frontmatter is YAML; YAML is fragile and inconsistently parsed.
- HTML renders directly in browsers. No build step to view a page.
- HTML is a stricter contract — once a page is canonicalized, two saves produce the same bytes.
- HTML lets us embed structured affordances (wikilinks, callouts, task checkboxes, hub queries) without inventing Markdown extensions.

You still write in Markdown — templates and inbox sources are Markdown. A converter promotes them to canonical HTML when they enter the brain. After that, the HTML is what changes.

This is non-negotiable for the brain itself. Operational logs (`logs/changelog.md`, `logs/ingest-log.md`) stay as Markdown because they're append-only streams humans grep.

## 3. Capture first, durable later

There are three surfaces:

```
inbox/   →   brain/   →   out/
```

- **`inbox/`** is the immutable capture zone. Meeting transcripts, exported chats, screenshots, raw notes. Append-only by convention. Never edited after landing.
- **`brain/`** is durable knowledge. Edited iteratively. Always traceable back to its sources via `robin:source` meta tags.
- **`out/`** is for humans outside the system: slides, plans, board reports, reviewed proposals. Polished, styled, audience-tailored.

Knowledge moves left to right. A meeting lands in `inbox/`. The agent ingests it: extracts decisions into `brain/decisions/`, action items into `brain/tasks/`, summary into a meeting page in `logs/meetings/`, durable patterns into `brain/patterns/`. When you need to brief your board, you draw from `brain/` and craft a deck in `out/`.

Implication: **never edit `inbox/`.** Once captured, it is history. Edits live in `brain/`.

## 4. Two memory layers: brain pages vs. event stream

The brain has two memory shapes:

- **HTML pages** in `brain/<area>/<slug>.html`. Rich, structured, browsable, the canonical durable surface. Use for entities (people, projects, decisions, patterns) that deserve their own identity.
- **JSONL events** in `brain/memory/events.jsonl`. Compact, machine-readable, tiered by working/episodic/semantic/procedural. Use for *recall cues* — preferences, corrections, source-of-truth warnings, dated facts — that are too small for a page but too valuable to forget.

Plus a third layer that sits *outside* the repo:

- **Auto-memory** — your agent's own session-persistent memory (e.g., Claude Code's `~/.claude/projects/<encoded-path>/memory/`). Use for *how the agent should work with you* (tool preferences, repo conventions, working agreements). These are decisions about the agent, not facts about the world.

When in doubt: an entity gets a page; a recall cue gets a memory event; a working agreement gets auto-memory. See [`05-two-memory-layers.md`](./05-two-memory-layers.md).

## 5. The constitution is law; skills are verbs

A bare LLM has no opinions. Robin gives the agent **opinions** by reading two things at session start:

- **`CLAUDE.md`** (or equivalent) — the entry point. Short. Routes the agent into the constitution.
- **`.claude/constitution/`** — the split-by-concern operating rules. Identity. Writing style. How to handle decisions. When to update vs. fork. How to communicate.

The constitution is **the agent's law**. If the agent's behavior is wrong, the constitution is wrong. Edit it. The agent re-reads it next session and adapts.

On top of the constitution, **skills** are the agent's verbs — invocable workflows:

- `/learn` — promote durable knowledge before compaction.
- `/morning-brief` — orchestrate the start-of-day briefing.
- `/remsleep` — end-of-day multi-phase consolidation.
- `/ingest-source`, `/ingest-meeting` — turn captures into durable knowledge.
- `/lint-wiki` — audit vault health.
- (plus optional comms checks and outputs)

A skill is a `.md` file with a frontmatter header. The agent reads it when you type `/skill-name`. It does what the file says. You promote a workflow to a skill once you've done it manually three or more times the same way.

---

## What you give up

This system is a commitment.

- **You write things down.** Even when the conversation is going great. Especially then.
- **You trust files over chat.** When you need to find something, you look in `brain/`, not scroll up.
- **You let the agent edit the brain.** A protective instinct says "I'll write durable knowledge myself, the agent can suggest." Resist it. The agent writes more reliably than you do, and every gate you add becomes a place the knowledge dies.

## What you get

- **Continuity.** Last week's decision is one wikilink away, not buried in chat history.
- **Honesty.** Every page carries provenance. You can trace why you believe what you believe.
- **Compounding.** Knowledge grows. Patterns get extracted. Hubs index recurring topics. The system gets more useful over months, not less.
- **Sharing.** Other agents (and other humans) can read the same brain. The format is open.

This is the bet: **a durable, structured, plain-file knowledge base is more powerful than a longer context window.**

Continue: [`02-architecture.md`](./02-architecture.md).
