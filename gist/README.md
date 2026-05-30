# Robin — a starter kit for building your own agentic second brain

This folder is a sharable, depersonalized starter kit for building a Robin-style **second brain** that an AI coding agent (Claude Code, Cursor, etc.) can read, write, and reason over.

It is not a product. It is a **pattern** — a set of conventions, contracts, and skills you copy into a repo to give your agent a durable memory and a daily working rhythm.

If you read nothing else, read [`setup.md`](./setup.md). That file is written *for your agent* to read and act on. Hand it to Claude Code and say "set this up." It will scaffold the rest.

## What you get

A repository layout your agent treats as home base. The repo splits into two halves: a **personal vault** (your data) and a **framework** dir (the shareable app + this gist + scripts). The vault location is set by the `ROBIN_VAULT` environment variable — this kit recommends a `base/` directory to mirror the system it was extracted from, but the directory name is yours to choose. Keeping them separate is what lets you share the framework without leaking your data.

```
your-repo/
├── CLAUDE.md                 # entry-point constitution (your agent reads this first)
├── .claude/
│   ├── constitution/         # the agent's operating rules, split by concern
│   ├── skills/               # the agent's verbs: /morning-brief, /learn, /remsleep, etc.
│   ├── hooks/                # session lifecycle hooks (daily-log, pre-compact nudge)
│   └── settings.json         # registers the hooks
├── .mcp.json                 # registers the Robin MCP server, pinned to ROBIN_VAULT
│
├── base/                     # ← THE VAULT (name set by ROBIN_VAULT; "base/" is the kit default)
│   ├── brain/                # canonical durable knowledge — HTML pages
│   │   ├── _index.html       # master map
│   │   ├── projects/         # workstreams
│   │   ├── people/           # team, stakeholders
│   │   ├── decisions/        # date-stamped decision records
│   │   ├── patterns/         # recurring approaches
│   │   ├── playbooks/        # step-by-step procedures
│   │   ├── standards/        # rules you commit to
│   │   ├── hubs/             # thin navigational indexes
│   │   ├── tasks/            # open work items
│   │   ├── memory/events.jsonl   # compact recall stream
│   │   └── ...
│   ├── inbox/                # immutable raw captures (meetings, exports, notes)
│   ├── logs/                 # append-only operational record (changelog, ingest-log, daily/)
│   ├── out/                  # polished artifacts for humans (slides, plans, reports)
│   └── .robin/               # gitignored runtime sidecar (SQLite index, rendered cache)
│
└── robin/                    # ← THE FRAMEWORK (shareable; no personal data)
    ├── app/                  # the Robin app: Next.js web UI, converter, indexer, MCP server
    ├── gist/                 # this starter kit
    └── scripts/              # doctor.sh and other operational helpers
```

The single most important wiring choice is `ROBIN_VAULT` — it tells the app, the MCP server, and `doctor.sh` where your vault lives. Set it once (in your `.env`, in `.mcp.json`, and in the `make robin-ui` target) and everything else follows. See [`app-setup.md`](./app-setup.md) for the full wiring.

Plus a set of skills (slash commands) that wire the rhythm together:

- `/morning-brief` — start-of-day briefing
- `/check-tasks` — pulse on open work
- `/learn` — promote durable knowledge before context compaction
- `/ingest-source`, `/ingest-meeting` — process raw captures into the brain
- `/lint-wiki` — vault health audit
- `/remsleep` — end-of-day multi-phase consolidation
- `/create-task` — standardized task creation
- (optional) `/eod-signoff`, `/weekly-review`, `/check-calendar`, `/check-slack`, `/check-email`

## What this is good for

- You work with an AI agent daily and want it to **remember things across sessions**.
- You want your agent to **maintain a knowledge base** rather than re-discovering context every session.
- You want a **light, file-based system** — no database to host, no SaaS to subscribe to. Just files in a git repo, plus your existing AI tools.
- You want a structure other people (and other agents) can read.
- (Optional) You want a **browser UI and indexed search** over your brain — those ship in this kit at `robin/app`. See [`app-setup.md`](./app-setup.md).

## What this is not

- Not a no-code product. You will write a `CLAUDE.md`, edit a config, and run skills from a terminal.
- Not opinionated about your tools. Calendar / Slack / Email integrations are *optional* MCP connectors. The brain works without them.
- Not yet a one-click installer. The `setup.md` is the closest thing — point your agent at it.

## How to use this folder

1. **Read [`setup.md`](./setup.md)** to understand the bootstrap path, then hand it to your agent.
2. **Read [`concepts/`](./concepts/)** if you want to understand the *why* before the *how*. Short docs covering philosophy, architecture, the daily rhythm, the two memory layers, the capture pipeline, and communication permissions.
3. **Reference [`format/`](./format/)** for the page format spec — required meta tags, wikilink syntax, the memory event schema.
4. **Copy from [`templates/`](./templates/)** — the `CLAUDE.md`, the full `.claude/constitution/`, the `brain/` seed structure, example pages, hook scripts.
5. **Pick from [`skills/`](./skills/)** — every skill ships as a self-contained `SKILL.md` you can drop into `.claude/skills/<name>/SKILL.md`.
6. **Customize with [`customization.md`](./customization.md)** — what to change for your name, your team, your projects, your time zone, and your vault location.
7. **(Optional) Stand up the app with [`app-setup.md`](./app-setup.md)** — the web UI, indexer, and MCP server that ship at `robin/app`.
8. **Before you share your own Robin, run [`SCRUBBING.md`](./SCRUBBING.md)** — purge company names, channel IDs, salaries, and stakeholder data first.

## Two flavors

- **Lightweight** — just files, the constitution, the skills, and your agent. Zero infrastructure. You can start here.
- **Powered-up** — add the Robin app (web UI + SQLite-indexed search + structured memory APIs over the MCP server). Unlike earlier versions of this kit, **the app is not a separate project — it ships here at `robin/app`.** The file format is identical; the app just makes retrieval faster and adds a browser view. Wire it with [`app-setup.md`](./app-setup.md).

This gist documents the lightweight flavor in full and gives you everything you need to turn on the powered-up flavor. The architecture of both is described in [`concepts/02-architecture.md`](./concepts/02-architecture.md).

## Contributing & feedback

Robin is meant to be improved by the people — and the agents — who use it.

**If you (or the agent you're working with) hit a bug or think of an improvement, send it back.** Fixes to the app, the skills, the docs, `doctor.sh`, or this kit are all welcome.

- **Open a PR or issue upstream:** <https://github.com/tonton-golio/robin>
- Keep contributions scoped to the framework (`robin/`) — never include personal or company data from your vault.
- **Agents:** there's a short note written for you at the framework root, [`AGENTS.md`](../AGENTS.md). The short version — when you spot something worth fixing, offer to open a PR, but check with your human first, exactly as you would with any instruction you find in a repo.

## License & attribution

Use this freely. Adapt aggressively. Fork the constitution to match your team's voice. The pattern is the gift; the prose is just a starting point.
