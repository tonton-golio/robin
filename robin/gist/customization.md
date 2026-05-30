# Customization

A starter kit, by design, is generic. Most of what makes the system useful is the personalization layer on top. Here is what to change, and where.

## Things you customize once at setup

| What | Where | Why |
|---|---|---|
| **Vault location** | `ROBIN_VAULT` env var (in `.env.local`, `.mcp.json`, `make robin-ui` target); `{{VAULT_DIR}}` in `CLAUDE.md` | Tells the app, MCP server, and `doctor.sh` where your vault lives. The single most important variable. Kit default: `base/`; the name is yours. |
| **Agent's name** | `CLAUDE.md`, `.claude/constitution/identity.md`, signature line in `communications.md` | Identity. Pick anything — Robin, Iris, Atlas. |
| **Your name / owner identity** | App: `ROBIN_OWNER` + `NEXT_PUBLIC_ROBIN_OWNER` env (`.env.local`). Claude Code side: `CLAUDE.md`, `.claude/constitution/identity.md` + `{{USER_NAME}}`. | App greetings/persona/attribution read `ROBIN_OWNER` via `lib/config.ts` (generic when unset). The constitution covers terminal sessions. |
| **Org / org glossary** | `ROBIN_ORG` + `ROBIN_ORG_GLOSSARY` env (`.env.local`) | Org name woven into the persona; the comma-separated glossary boosts meeting-transcription keyterms. Both env-driven (no code edit); empty by default. |
| **Time zone** | `config.yaml` (`timezone:` line), used by daily-rhythm skills | Calendar display, scheduling, due-date math. |
| **Email** | `.claude/skills/check-email/SKILL.md` (`email:` config), signature | Inbox triage and outgoing messages. |
| **Strategic lenses** | `identity.md` (last section) | Tensions you're actively navigating. Keep 2–3 max. |
| **`about_user/` basename** | `brain/about_user/` (and references in `_index.html`, hubs, wikilinks) | The personal-context directory. The basename itself is a personalization point — rename to `about_<you>` if you like; keep it `about_user/` in anything shared. |

## Things you customize as you grow

| What | Where | When |
|---|---|---|
| **Project enum** | `config.yaml`, `create-task` SKILL.md, `weekly-review` SKILL.md | Add a project when you start one. |
| **Team members** | `brain/people/team/`, `config.yaml` (`team_members:`) | When you onboard or off-board someone. |
| **Stakeholders** | `brain/people/stakeholders/`, optionally `config.yaml` | When a new key person enters your orbit. |
| **Slack channels** | `config.yaml` (`team_standup_channel:`, `primary_channels:`) | When you join a new important channel. |
| **Noise senders** | `check-email` SKILL.md (`noise_senders:` list) | When a newsletter or bot becomes background noise. |
| **Hubs** | `brain/hubs/` | When you notice 3+ scattered references to a topic. Make a hub. |
| **Ritual blocks** | `config.yaml` (`self_reflection:`, `weekly_review:`, etc.) | When you want to add or pause a recurring check. |

## Things you should leave alone (at first)

| What | Why |
|---|---|
| **The page format** ([`format/`](./format/)) | Tools rely on this contract. Add fields to frontmatter, don't rename existing ones. |
| **Memory event schema** ([`format/memory-events.md`](./format/memory-events.md)) | The JSONL append-only contract is what makes recall stable. |
| **The capture → durable → artifact pipeline** | inbox/ → brain/ → out/ is the spine. Don't merge them. |
| **Append-only logs** | `changelog.md` and `ingest-log.md` are immutable audit trails. Never edit history. |

## Things you should change *with intent*

| What | Why |
|---|---|
| **Conversation style** (`conversation-style.md`) | This is how your agent talks to you. If the defaults grate (e.g., always offering A/B/C options), change them — but capture *why*. |
| **Communication permissions** (`communications.md`) | Draft-first vs. autonomous is a trust calibration. Default is conservative; loosen it as trust grows. |
| **Daily rhythm** (`daily-rhythm.md`) | The three-skill triad (morning-brief / check-tasks / remsleep) is the load-bearing pattern. Other rituals (weekly review, self-reflection, stakeholder pulse) are gated by `config.yaml` — add or remove freely. |
| **Maintenance cadence** (`maintenance.md`) | How often does `/lint-wiki` run? When are tasks "stale"? When are hubs "decayed"? Pick numbers that match your work pace. |

## Adding a new skill

A skill is a `.md` file in `.claude/skills/<skill-name>/SKILL.md`. It is read at the start of every session and exposed as a slash command.

Anatomy:

```markdown
---
name: skill-name
description: One sentence that helps you decide whether to invoke this.
---

# /skill-name

## Purpose

(One paragraph.)

## When to use

- (Trigger one.)
- (Trigger two.)

## Steps

1. (Action.)
2. (Action.)
3. ...

## Output

(What the user sees when this runs.)

## Notes

(Edge cases, dependencies, things that can go wrong.)
```

Rule of thumb: **promote a workflow to a skill once you've done it manually 3+ times the same way.** Fewer and better.

## Adding a new directory under `brain/`

The default taxonomy covers most cases. Before adding a directory, ask: *could this go in `hubs/` instead?* Hubs are navigation; new directories are commitments.

If you need a new directory:

1. Add it under `brain/`.
2. Add an `_index.html` to it (use any `_index.html` template as a starting shape).
3. Link it from `brain/_index.html` master map.
4. Update `.claude/constitution/knowledgebase.md` so the agent knows when to place things there.

## Adding optional power-ups

The lightweight pattern (just files) works on day one. When you want more, **use what ships in this kit — don't rebuild it.** The app lives at `robin/app`; full wiring is in [`app-setup.md`](./app-setup.md).

- **A web UI for browsing the brain.** Ships at `robin/app/apps/web` (Next.js, port 8400). It renders your canonical HTML directly. Run it with `make robin-ui`. Do not build your own viewer from scratch.
- **Indexed search.** Ships at `robin/app/packages/indexer` — a chokidar watcher + SQLite FTS5 + optional vector embeddings, maintaining `<vault>/.robin/index.db`. Do not write your own indexer; point this one at your `ROBIN_VAULT`.
- **An MCP server.** Ships at `robin/app/packages/mcp-server` — exposes `page_read`, `page_write`, `memory_save`, `knowledge_search`, `task_create`, and more to your agent. Wire it via `.mcp.json` (see [`app-setup.md`](./app-setup.md)). Do not hand-roll one.
- **A Markdown → HTML converter.** Ships at `robin/app/packages/converter` for importing legacy notes into canonical HTML.
- **Retrieval.** The production implementation is `robin/app/packages/indexer` (SQLite FTS5 + vector embeddings + RRF/decay scoring, graph-aware), exposed via `knowledge_search` on the MCP server. Read its `src/` and `README.md` to understand how retrieval works; don't build your own.

These are upgrades, not requirements. The lightweight setup works without any of them.

## `.gitignore`: what to keep out of git

Robin generates rebuildable state and holds sensitive personal data. Both must stay out of git. A minimal `.gitignore` (paths shown for a `base/` vault — substitute your `ROBIN_VAULT` dir name):

```gitignore
# OS / editor cruft
.DS_Store
**/.DS_Store

# Secrets and env files (keep the example tracked)
.env
.env.*
!.env.example
!.env.*.example

# Node / build artifacts
node_modules/
robin/app/**/.next/
robin/app/**/dist/
robin/app/**/.turbo/
robin/app/**/test-results/

# Robin runtime sidecar — rebuildable index + rendered cache
base/.robin/

# Local Claude state
.claude/settings.local.json
.claude/worktrees/

# Sensitive personal data — NEVER commit
base/inbox/contracts/        # employment/bonus/comp documents

# Personal assets served to decks — keep local, exclude from the shareable framework
robin/app/apps/web/public/deck-assets/

# Nested working repos and tool caches (local workspace state)
base/repos/
robin/tools/**/node_modules/
robin/tools/**/.venv/
robin/tools/**/__pycache__/
robin/tools/**/chroma_db/
```

Rules of thumb:

- **Ignore the sidecar.** `<vault>/.robin/` (including `index.db` and the rendered cache) is fully rebuildable from your HTML — never commit it.
- **Ignore secrets.** `.env` / `.env.*` stay local; only `.env.example` (no real values) is tracked.
- **Ignore generated build output.** `node_modules/`, `.next/`, `dist/`, `.turbo/`.
- **Ignore sensitive vault content.** Contracts, comp docs, and personal asset dirs.
- **Do NOT ignore canonical brain HTML.** `<vault>/brain/**/*.html` must stay tracked — that's your knowledge base. `doctor.sh` checks this both ways.

## Before sharing your Robin

Customization is also where you decide what *not* to expose. Before you publish a fork or hand the framework to a teammate, run the [`SCRUBBING.md`](./SCRUBBING.md) checklist — it walks through purging company names, channel IDs, salaries, stakeholder names, and the `about_<you>` directory basename, and confirms the vault stays out of the share.

## When in doubt

The constitution is the agent's law. If a behavior feels wrong:

1. Check if the behavior is governed by a constitution file.
2. Edit that file.
3. Commit the change.
4. Start a new session — the agent re-reads the constitution at session start.

The agent's behavior **should** change in lockstep with the constitution. If it doesn't, the constitution is unclear; rewrite the offending section. Treat the constitution as living code.
