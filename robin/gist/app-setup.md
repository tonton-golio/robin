# App setup — web UI, indexer, and MCP server

> Optional. The lightweight, file-only flavor (see [`setup.md`](./setup.md)) works without any of this. Turn this on when you want a **browser UI**, **indexed search**, and an **MCP server** your agent can call instead of writing files by hand.

The app **ships in this kit** at `robin/app`. It is a Node/TypeScript monorepo (npm workspaces) that reads and writes the same canonical HTML files described in [`format/`](./format/) — nothing about your brain changes. (Earlier revisions of this gist said the app was "a separate project, not in this gist." That is no longer true.)

---

## What's in `robin/app`

```
robin/app/
├── apps/
│   └── web/                  # Next.js app: brain UI, interview, meeting (port 8400)
├── packages/
│   ├── converter/            # Markdown import → canonical HTML pipeline
│   ├── indexer/              # chokidar watcher + SQLite (FTS5 + optional vector embeddings)
│   ├── mcp-server/           # Robin MCP stdio server (the tools your skills call)
│   ├── memory/               # structured memory records (agentmemory pattern)
│   └── shared/               # types/utilities shared across packages (path-imported src/, NOT an npm workspace — no package.json)
└── ROBIN_FORMAT.md           # the locked file-format spec the app enforces
```

The app is single-user and local-first: no deployment, no auth. It serves on `localhost:8400` and keeps a rebuildable sidecar index at `<vault>/.robin/index.db`.

Prerequisite: **Node ≥ 24** (`robin/app/.nvmrc` pins `24`).

---

## The one variable that matters: `ROBIN_VAULT`

Every part of the system resolves your vault from **`ROBIN_VAULT`** — an absolute path to your vault directory (this kit's default is `<repo>/base`). The web app, the MCP server, and `robin/scripts/doctor.sh` all read it. Set it consistently in three places:

1. The web app's `.env.local` (or the `make robin-ui` target).
2. The MCP server's `env` block in `.mcp.json`.
3. Anywhere you invoke a package CLI directly.

If these disagree, the UI and the MCP will read different vaults. Keep them identical.

---

## Step 1 — Create the web app `.env.local`

Copy the example and edit it:

```bash
cp robin/app/apps/web/.env.example robin/app/apps/web/.env.local
```

The keys in `.env.example`, and what to set:

| Key | Required? | What it is |
|---|---|---|
| `ROBIN_VAULT` | **Yes** | Absolute path to your vault. Set this first. e.g. `/Users/you/your-repo/base`. |
| `ROBIN_OWNER` | Optional | Your display name. Drives greetings, the assistant persona, transcript/annotation author, etc. Unset → the app stays generic ("Good morning.", "You"). |
| `ROBIN_ORG` | Optional | Your org/company name, woven into the assistant persona. Unset → no org is named. |
| `ROBIN_ORG_GLOSSARY` | Optional | Comma-separated org/product terms that boost meeting-transcription keyterms (e.g. `Acme,acme.com,ProjectX`). Merged with `Robin`. |
| `NEXT_PUBLIC_ROBIN_OWNER` | Optional | Same as `ROBIN_OWNER` but for the client chat label. Inlined at **build time** — rebuild to change it. |
| `ASSISTANT_MODE` | Optional | `claude` to use the Claude CLI for the in-app assistant; `stub` for deterministic local responses without it. |
| `ASSISTANT_CLAUDE_CWD` | Optional | Working directory the in-app assistant runs Claude from — set to your **repo root** (not the vault), so the agent sees `CLAUDE.md` and `.claude/`. |
| `ASSISTANT_SESSION_FILE` | Optional | Where the assistant persists its session (under `<vault>/.robin/`). |
| `ROBIN_XAI_MODE` / `XAI_API_KEY` / `INTERVIEW_*` | Optional | The interview voice relay (xAI Realtime). Leave `stub` / blank unless you use it. |
| `ROBIN_WHISPER_MODE` / `OPENAI_API_KEY` | Optional | Meeting transcription fallback (`stub` fixtures, `local` whisper-node, or `openai`). |
| `DEEPGRAM_API_KEY` | Optional | Live meeting transcription via Deepgram (the recorder's default STT). |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | Optional | Meeting AI processing (titles, summaries, action items). Default model `anthropic/claude-sonnet-4.5`. |
| `MEETING_RECORDER_APP_PATH` | Optional | Path to a native meeting-recorder app. Leave blank unless you wire one up. |
| `MEETING_RECORDER_HELPER_URL` | Optional | URL of the meeting-recorder helper the web app talks to for system-audio capture. Leave blank unless you wire one up. |

> **Note on ownership/org strings.** The app reads your identity from env (`ROBIN_OWNER`, `ROBIN_ORG`, `ROBIN_ORG_GLOSSARY`, and `NEXT_PUBLIC_ROBIN_OWNER` for the client chat label) via `robin/app/apps/web/lib/config.ts`, with generic fallbacks when unset — so the framework ships clean and you personalize purely through `.env.local`. (The Claude Code side — agent persona for terminal sessions — still comes from `CLAUDE.md` and `.claude/constitution/identity.md`; set those too.) `.env.local` is gitignored; keep secrets there, never in `.env.example`.

---

## Step 2 — Install and build

```bash
cd robin/app
npm install            # installs all workspaces
# build just the packages you need (fast, no env required):
npm run build --workspace=@robin/mcp-server --workspace=@robin/indexer --workspace=@robin/converter
```

The MCP server compiles to `robin/app/packages/mcp-server/dist/cli.js` — that path is what `.mcp.json` points at, so building is required before the MCP works.

> **About the root `npm run build`.** The root script is `npm run build --workspaces --if-present`, which builds **every** workspace that has a `build` — *including `apps/web`, whose build is `next build`*. `next build` needs your env (at minimum `ROBIN_VAULT`) set first, or it can fail or bake in wrong values. So on a fresh install, **build the packages explicitly** (above) before attempting a full `next build`. For day-to-day UI work you don't need a production web build at all — `make robin-ui` (Step 3) runs the dev server. Only run the full web build when you want a production bundle, and set env first (see [Step 1](#step-1--create-the-web-app-envlocal)). (`packages/shared` has no `package.json`, so it's not a workspace and nothing builds it — it's path-imported `src/`.)

---

## Step 3 — Run the web UI

From the repo root:

```bash
make robin-ui
```

That target runs the Next.js dev server on **`localhost:8400`**. The shipped `Makefile` defaults `ROBIN_VAULT` to `./base` (the kit convention), so if your vault is `base/` it just works. If you chose a different `<vault>`, override it per-invocation or set it in `.env.local`:

```bash
make robin-ui ROBIN_VAULT=/abs/path/to/your/<vault>
# …or run the dev server directly:
cd robin/app/apps/web && ROBIN_VAULT=/abs/path/to/your/<vault> npm run dev
```

Open `http://localhost:8400` and you should see your brain rendered from the canonical HTML. The indexer watches `<vault>/brain/**` and maintains `<vault>/.robin/index.db` as you edit.

> Dev-server gotcha: Turbopack can serve stale CSS *and* stale TSX across incremental edits. If a change doesn't show up, `rm -rf robin/app/apps/web/.next` and restart from a cold build before concluding anything is broken.

---

## Step 4 — Wire the MCP server (`.mcp.json`)

Create `.mcp.json` at the **repo root** so Claude Code loads the Robin MCP server. The kit ships this as a template at [`templates/mcp.json`](./templates/mcp.json) — copy it and replace `{{REPO_ROOT}}` and `{{VAULT_DIR}}`. Point `args[0]` at the built CLI and put `ROBIN_VAULT` in `env`:

```json
{
  "mcpServers": {
    "robin": {
      "command": "node",
      "args": ["/abs/path/to/your/repo/robin/app/packages/mcp-server/dist/cli.js"],
      "env": {
        "ROBIN_VAULT": "/abs/path/to/your/repo/<vault>"
      }
    }
  }
}
```

Use **absolute paths**. After editing `.mcp.json`, reconnect the MCP in your client (in Claude Code: `/mcp`). If you rebuild the server, reconnect again — a stale `dist` is the usual cause of MCP errors.

Once connected, your agent has tools like `page_read`, `page_write`, `page_create`, `page_list`, `page_search`, `knowledge_search`, `memory_save`, `memory_search`, `task_create`, `vault_lint`, `vault_stats`, `link_add`, and `log_append`. Skills in this kit that call `mcp__robin__*` (e.g. `/check-tasks`, `/create-task`, `/lint-wiki`) use these; without the MCP they fall back to direct file reads.

---

## Step 5 — Verify with `doctor.sh`

From the repo root:

```bash
make doctor          # or: ./robin/scripts/doctor.sh
```

`doctor.sh` checks the wiring you just did, including:

- `.mcp.json` exists, its CLI path resolves to a file, and its `ROBIN_VAULT` actually contains a `brain/` directory.
- Generated/secret files are gitignored (the `.robin/` sidecar, `index.db`, `.env` files) while canonical brain HTML stays tracked.
- Every skill `SKILL.md` starts with YAML frontmatter at byte 0.
- Brain pages carry required `robin:*` meta tags; `brain/` has no Markdown; `out/` is HTML-only.
- The append-only logs exist (`logs/changelog.md`, `logs/ingest-log.md`, `logs/repo-log.md` — seed all three; see [`setup.md`](./setup.md) Step 4).

> **`doctor.sh` is two tools in one: a wiring check *and* a content linter.** On a **fresh, seeded** vault it should pass clean — that confirms your *setup* is correct. On an **established, real** vault it may also report **content findings** that are not wiring failures: `out/` files that aren't HTML-only, archived tasks that still carry an active `robin:state`, or stale-path grep hits. Those mean "doctor found pre-existing content to clean up," not "your install is broken." When triaging a failure, separate the two: a broken `.mcp.json` (an unresolvable CLI path, or a `ROBIN_VAULT` without a `brain/`) is a **wiring** problem you must fix to proceed; a content lint hit is a **maintenance** task you can address later (often via `/lint-wiki` or `/remsleep`). On the lightweight (file-only) flavor there is no `.mcp.json`, and doctor **skips** the MCP check cleanly — that's expected, not a failure.

> `doctor.sh` auto-resolves your vault from `ROBIN_VAULT` (or the `ROBIN_VAULT` set in `.mcp.json`, else the `base/` default) and expresses every in-vault path relative to it — so a vault dir with a custom name needs **no edits** to the script. Just make sure `ROBIN_VAULT` (or `.mcp.json`) names your vault dir and that it contains a `brain/`.

---

## Retrieval: use what ships, don't build your own

Do **not** write your own indexer from scratch. Two things already exist:

- **Production retrieval** lives in `robin/app/packages/indexer` (SQLite FTS5 + vector embeddings + RRF/decay scoring, graph-aware) and is exposed through `robin/app/packages/mcp-server`. This is what `knowledge_search` and the UI search use — point it at your `ROBIN_VAULT` rather than building your own.

---

## Troubleshooting

- **MCP tools missing or erroring** → rebuild (`cd robin/app && npm run build`), then reconnect with `/mcp`. Stale `dist` is the most common cause.
- **UI shows old content / stale styles** → `rm -rf robin/app/apps/web/.next`, restart, verify from a cold build.
- **`doctor.sh` fails on `ROBIN_VAULT does not contain brain/`** → your `.mcp.json` `ROBIN_VAULT` is wrong or the vault dir name doesn't match. Make `.mcp.json`, `.env.local`, the `Makefile` target, and `doctor.sh` all agree.
- **Web UI strips `<style>`/`<script>` from a page** → that's by design; the reader renders semantic HTML. For charts in `out/` pages use inline-SVG with `fill`/`stroke` attributes, not CSS.
