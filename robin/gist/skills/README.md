# Skills

Skills are slash commands the agent invokes during normal work. Each is a single `SKILL.md` file inside a folder under `.claude/skills/`.

When the user types `/learn`, the agent reads `.claude/skills/learn/SKILL.md` and follows the steps within. It is *just a file*. The mechanism is intentionally simple.

## What to install

### Essential (start here)

These are the core verbs of the daily rhythm. Install all eight:

- [`learn/`](./learn/SKILL.md) — promote durable knowledge before context loss. The most-used verb.
- [`morning-brief/`](./morning-brief/SKILL.md) — start-of-day orchestration.
- [`remsleep/`](./remsleep/SKILL.md) — end-of-day multi-phase consolidation.
- [`ingest-source/`](./ingest-source/SKILL.md) — process inbox sources into the brain.
- [`ingest-meeting/`](./ingest-meeting/SKILL.md) — process meeting transcripts.
- [`lint-wiki/`](./lint-wiki/SKILL.md) — vault health audit.
- [`check-tasks/`](./check-tasks/SKILL.md) — task pulse.
- [`create-task/`](./create-task/SKILL.md) — standardized task creation.

Plus the shared library:

- [`lib/`](./lib/) — conventions reused across multiple skills (report template, provenance format).

### Optional (install when relevant)

These require external integrations (Calendar / Slack / Email / GitHub MCPs).

- [`check-calendar/`](./check-calendar/SKILL.md) — review upcoming schedule.
- [`check-slack/`](./check-slack/SKILL.md) — scan Slack for what needs attention.
- [`check-email/`](./check-email/SKILL.md) — triage email inbox.
- [`eod-signoff/`](./eod-signoff/SKILL.md) — draft and post an end-of-day standup.

Install only when their MCP is connected. They're useful but not essential — the brain works without any of them.

> **Intentionally omitted:** `weekly-review` and the `launch-*` skills (e.g. launchers for a specific app stack) ship in the original system but are deeply repo- and team-specific (hardcoded project channels, repo names, stack layout). They are left out of this generic kit on purpose — build your own once your team and projects stabilize, following the skill anatomy below.

## How skills are read

In Claude Code (and similar agents), the skill files are read at session start. The frontmatter declares the skill's name, description, and which tools it can use. The body describes the workflow.

A SKILL.md has this shape:

```markdown
---
name: skill-name
description: One sentence describing when to use this skill.
allowed-tools: Read, Write, Edit, Bash(grep:*), mcp__robin__*
---

# /skill-name

(Body: purpose, arguments, steps, output, edge cases.)
```

Adapt the `allowed-tools:` line to your harness. The body is the agent-facing instruction.

## Anatomy of a good skill

- **Triggers** — when is this skill the right answer? Clear conditions.
- **Steps** — numbered, ordered. The agent walks them top to bottom.
- **Output** — exactly what the user sees when the skill completes.
- **Side effects** — what files are written, what logs are appended, what external actions are taken.
- **Edge cases** — what to do when something is missing, when a dependency isn't available, when the input is bad.

A bad skill is one paragraph. A good skill is structured enough that a future agent reads it and behaves consistently.

## Promoting a workflow to a skill

When you find yourself doing the same multi-step workflow 3+ times the same way:

1. Open a SKILL.md skeleton (see [`learn/SKILL.md`](./learn/SKILL.md) for a template).
2. Capture the steps.
3. Test it on the next invocation.
4. Refine.

Don't promote earlier. A skill captured before it stabilizes is overhead.

## Customization

Every skill in this folder has placeholders (`{{USER_NAME}}`, `{{AGENT_NAME}}`, `{{TIMEZONE}}`, `{{TEAM_CHANNEL_ID}}`, etc.). Search each file for `{{` and replace.

See [`../customization.md`](../customization.md) for the full guide.
