# Robin

**A starter kit for building your own agentic second brain** — a durable, local-first knowledge base that an AI coding agent (Claude Code, Cursor, and friends) can read, write, and reason over, plus a daily working rhythm to keep it healthy.

Robin is not a product. It's a **pattern**: a set of conventions, a file format, an MCP server, a local web UI, and a library of agent skills you copy into a repo to give your agent a real memory.

## What's in here

```
app/        The Robin app — a Next.js web UI, the Markdown→HTML converter,
            the file indexer (SQLite FTS + optional vectors), and the MCP
            server that exposes your vault to an AI agent.
gist/       The starter kit: the operating model, the file-format spec,
            templates for the constitution, skills, and brain scaffolding,
            and a setup guide written for your agent to read and act on.
scripts/    Operational helpers (doctor.sh — a vault health audit).
```

Your own data lives in a **vault** directory (the kit convention is `base/`, but the location is yours — set by the `ROBIN_VAULT` environment variable). Keeping your vault separate from this framework is what lets you share the framework without leaking your data.

## Getting started

The fastest path: open [`gist/setup.md`](./gist/setup.md) with your agent and ask it to set things up — that file is written to be read and executed by an AI agent. For the full picture:

- [`gist/README.md`](./gist/README.md) — what Robin is and the repo layout
- [`gist/setup.md`](./gist/setup.md) — scaffold a fresh vault + control plane
- [`gist/app-setup.md`](./gist/app-setup.md) — wire up and run the app + MCP server
- [`gist/customization.md`](./gist/customization.md) — make it yours
- [`app/README.md`](./app/README.md) — app internals and developer commands

Then run the UI:

```bash
make robin-ui        # http://localhost:8400  (set ROBIN_VAULT first)
make doctor          # audit your vault's health
```

## Requirements

Node 24+ and npm. The app is a Next.js / React monorepo (npm workspaces). See `app/.node-version`.

## License

MIT — see [LICENSE](./LICENSE).
