# {{PROJECT_NAME}}

This repo is {{USER_NAME}}'s **second brain** — a structured, durable knowledge base shared with an AI agent named {{AGENT_NAME}}.

Read these at the start of every session:

1. `.claude/constitution/identity.md` — mission, scope, defaults, strategic lenses.
2. `.claude/constitution/guide.md` — index into the full split-by-concern constitution.
3. `.claude/constitution/format.md` — the durable storage contract (HTML-only brain).
4. `{{VAULT_DIR}}/brain/_index.html` — master map of the knowledge base.

## Core intention

Make this repo a continuously growing, self-cleaning knowledge base. Capture in `{{VAULT_DIR}}/inbox/`, promote durable knowledge into `{{VAULT_DIR}}/brain/` (HTML only), keep compact recall in `{{VAULT_DIR}}/brain/memory/events.jsonl`, surface drift via maintenance, and preserve provenance throughout.

## Repo shape (vault vs. framework)

This repo splits into two halves:

- **`{{VAULT_DIR}}/`** — your personal vault: `brain/`, `inbox/`, `logs/`, `out/`, plus a gitignored `.robin/` runtime sidecar. The vault location is set by the **`ROBIN_VAULT`** env var. This kit's default name is `base/`; replace `{{VAULT_DIR}}` throughout with whatever you chose.
- **`robin/`** — the shareable framework: the app (`robin/app`), this starter kit (`robin/gist`), and operational scripts (`robin/scripts`). No personal data lives here.

The control plane (`CLAUDE.md`, `.claude/`, `.mcp.json`, `Makefile`) lives at the repo root.

## Daily rhythm

- `/morning-brief` — start of day
- `/check-tasks --quick` — mid-day pulse on open work
- `/learn` — before `/compact`, or any time durable knowledge emerged
- `/remsleep` — end of day: cleanup, replay, synthesis, reflection

## Layout

- `{{VAULT_DIR}}/brain/` — canonical HTML knowledge
- `{{VAULT_DIR}}/inbox/` — immutable raw captures
- `{{VAULT_DIR}}/out/` — shareable artifacts crafted for humans outside the system
- `{{VAULT_DIR}}/logs/` — operational record (append-only Markdown + generated HTML)
- `.claude/` — control plane: constitution, skills, hooks
- `robin/` — the framework (app, gist, scripts)
- `.robin/` (inside the vault) — gitignored runtime sidecar only

Authoritative rules live in `.claude/constitution/`.

## Primary retrieval

1. `{{VAULT_DIR}}/brain/_index.html` (master map) — start here.
2. Direct page reads from `{{VAULT_DIR}}/brain/`, or the Robin app UI / MCP `knowledge_search` if the app is running.
3. `grep` / `rg` for implementation details (scope to `{{VAULT_DIR}}/brain/`).
4. The two memory layers: `{{VAULT_DIR}}/brain/memory/events.jsonl` (compact recall) and the agent's own auto-memory (working agreements between {{USER_NAME}} and {{AGENT_NAME}}).

## Reference docs

- The split-by-concern constitution under `.claude/constitution/`.
- The format spec for pages (HTML + `<meta name="robin:*">`): see `.claude/constitution/format.md`.
- The memory event JSONL schema: described in `.claude/constitution/learning.md`.
- The app (web UI, indexer, MCP server): `robin/app` — see `robin/gist/app-setup.md`.
