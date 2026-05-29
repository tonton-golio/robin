# Templates

Files you copy into your own repo, with placeholders to fill in. The setup guide ([`../setup.md`](../setup.md)) walks through them in order.

## What's here

- [`CLAUDE.md`](./CLAUDE.md) — the entry-point constitution for your repo root. Every agent session reads this first.
- [`constitution/`](./constitution/) — 14 files governing the agent's behavior. Copy all of them to `.claude/constitution/` at your repo root.
- [`brain/`](./brain/) — seed `_index.html` files for every brain subdirectory. Copy to `brain/` at your repo root.
- [`examples/`](./examples/) — example pages showing the canonical shape for each type (project, person, decision, hub, task, pattern). Use as starting templates when authoring.
- [`hooks/`](./hooks/) — `settings.json` and the two hook scripts (`pre-compact.sh`, `daily-log.sh`). Copy to `.claude/` and `.claude/hooks/`.
- [`inbox/`](./inbox/), [`logs/`](./logs/), [`out/`](./out/) — README files explaining what goes in each. Drop the README into the matching directory at your repo root, or use as reference and skip.

## Placeholders to replace

Every file uses one or more of these placeholders. Search each file for `{{` and substitute:

| Placeholder | Replace with |
|---|---|
| `{{AGENT_NAME}}` | Your agent's name (default: `Robin`). |
| `{{USER_NAME}}` | Your first name (or whatever name the agent should use for you). |
| `{{USER_EMAIL}}` | Your email address. |
| `{{PROJECT_NAME}}` | The name of your repo / project. |
| `{{VAULT_DIR}}` | Your vault directory name — the value of `ROBIN_VAULT` relative to the repo root (default: `base`). |
| `{{TIMEZONE}}` | Your time zone (e.g., `Europe/Copenhagen`, `America/New_York`). |
| `{{TEAM_CHANNEL_ID}}` | Slack channel ID for `/eod-signoff` (only if Slack MCP is enabled). |

## Order to apply

1. `CLAUDE.md` → repo root.
2. `constitution/*.md` → `.claude/constitution/` at repo root.
3. `brain/**/_index.html` → `brain/` at repo root.
4. `brain/memory/events.jsonl` (empty) → `brain/memory/events.jsonl` at repo root.
5. `hooks/settings.json` → `.claude/settings.json`.
6. `hooks/*.sh` → `.claude/hooks/` (and `chmod +x`).
7. (Optional) `inbox/README.md`, `logs/README.md`, `out/README.md` → the matching directories at your repo root.
8. `logs/changelog.md`, `logs/ingest-log.md` (the empty starter files) → `logs/` at your repo root.
9. (Optional) `examples/` → keep as reference, or copy a few into `brain/_examples/` for the agent to see.

## What's NOT here

- Skills. See [`../skills/`](../skills/) — copy from there into `.claude/skills/` at your repo root.

## After copying

Run the smoke test in [`../setup.md`](../setup.md) step 9.
