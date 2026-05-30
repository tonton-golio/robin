# Setup — agent bootstrap guide

> **Audience: an AI coding agent (Claude Code, Cursor, or similar) that has been given access to this folder.**
>
> Read this file in full before acting. Then walk the user through setup step by step. Ask clarifying questions when needed. Confirm before writing files outside this folder.

You are about to set up a **second brain** for a user: a structured, file-based knowledge system the user and their agents will share across sessions. The pattern is called **Robin**.

This file is your runbook. It assumes you can read other files in this `robin/gist/` folder.

---

## What you are building

**The recommended starting point is a fork of the Robin starter repo** (<https://github.com/tonton-golio/robin>) — or "Use this template". A fresh fork already contains:

- the **framework** at `robin/` (`robin/app`, `robin/gist`, `robin/scripts`), and
- the **repo-root glue**: `Makefile` (so `make robin-ui` / `make doctor` work from the repo root), `.gitignore`, `README.md`, `LICENSE`.

Your job in this guide is to add the parts that are personal and can't ship pre-filled — **two halves** plus the MCP wiring:

- **The control plane**, at the repo root:
  1. A `CLAUDE.md` that tells future agent sessions what the system is and where the rules live.
  2. A `.claude/constitution/` folder containing the agent's operating rules, split by concern.
  3. A `.claude/skills/` folder with slash commands the user invokes daily.
  4. A `.claude/hooks/` folder + `.claude/settings.json` for session lifecycle scripts.
  5. *(Only if the user wants the app/MCP)* a `.mcp.json`, scaffolded from [`templates/mcp.json`](./templates/mcp.json) — see Step 11.
- **The vault**, in a directory pointed to by the `ROBIN_VAULT` env var (this kit defaults to `base/`):
  6. A `brain/` folder containing the durable knowledge base.
  7. `inbox/`, `logs/`, `out/` folders for the capture → process → durable → artifact pipeline.

Most of this lives in *files*. No database, no server required for the lightweight flavor — the agent uses normal file I/O. If the user also wants the browser UI and indexed search, those ship in the framework at `robin/app`; wiring them is covered in the optional [`app-setup.md`](./app-setup.md) (and Step 11 below).

> If the user only copied this `gist/` folder rather than forking the whole repo, they won't have the repo-root `Makefile`/`.gitignore`. The lightweight (file-only) flavor needs neither — and Step 10 has a `.gitignore` example. The app flavor needs the full framework (`robin/app`, `robin/scripts`, the `Makefile`), so **forking the repo is the simpler path** to the app and the `make` targets.

Throughout this guide, **`<vault>`** means the directory you chose for `ROBIN_VAULT` (default `base/`). Substitute it everywhere you see it.

---

## Step 0 — Pre-flight checks

Before writing anything, confirm:

1. **Where should the repo live, and what is the vault directory called?**
   - Recommend a **fork of the Robin starter repo** (or "Use this template"). A fork already has the framework at `robin/` and the root glue (`Makefile`, `.gitignore`, `README`, `LICENSE`) in place. If the user only has this `gist/` folder, they'll create that glue during setup.
   - Inside the repo, the **vault** (all personal data) lives in a directory named by the `ROBIN_VAULT` env var. Default to `base/` to mirror this kit; let the user pick another name if they prefer. Record the choice as `<vault>` — you will substitute it everywhere.
   - The framework lives under `robin/` (`robin/app`, `robin/gist`, `robin/scripts`).

2. **What name does the user want for their agent?** The default is `Robin`. Other examples: `Iris`, `Atlas`, `Echo`. Use whatever the user picks. If they don't care, use `Robin`.

3. **What is the user's name and email?** Used in CLAUDE.md, signature lines on outgoing communications, and as the default `owner:` field on pages. Ask if it isn't obvious from `git config user.email` / `user.name`.

4. **What time zone?** Used by daily-rhythm skills. Default to the user's system time zone if unsure.

5. **Which optional integrations do they want now?** None are required to start. Ask in order of value:
   - Google Calendar MCP — for `/morning-brief` and `/check-calendar`.
   - Gmail MCP — for `/check-email`.
   - Slack MCP — for `/check-slack` and `/eod-signoff`.
   - GitHub CLI — for `/eod-signoff` and `/weekly-review`.

   It is OK to start with zero. The core brain works fine without any.

Confirm answers before writing files. Record them somewhere temporary so you can fill templates correctly.

---

## Step 1 — Lay down the folder structure

Create the control-plane directories and the **few** vault directories you will actually use on day one. Do **not** pre-build the full taxonomy — empty folders confuse the agent into populating them on weak signals (see [`concepts/02-architecture.md`](./concepts/02-architecture.md#the-minimum-viable-layout)). Let the rest appear when you have a real first entry. The `_index.html` template files exist for every directory, so adding one later is a two-step move (mkdir + copy its `_index.html`).

Control plane (always create these):

```
.claude/constitution/
.claude/skills/
.claude/hooks/
```

Vault — the recommended starting set (substitute `<vault>` for your chosen `ROBIN_VAULT` name, default `base`):

```
<vault>/brain/
<vault>/brain/projects/
<vault>/brain/people/
<vault>/brain/decisions/
<vault>/brain/tasks/
<vault>/brain/memory/
<vault>/inbox/
<vault>/logs/
<vault>/out/
```

Add `<vault>/brain/{patterns,playbooks,standards,hubs,strategy,repos,tools,work-log,unknowns,annotations,about_user}/`, `<vault>/inbox/meetings/`, `<vault>/logs/{daily,remsleep,meetings,reports}/`, etc., the first time you have something to put in them — copying the matching `_index.html` from [`templates/brain/`](./templates/brain/) at the same time. (The reference layout for the complete taxonomy is in [`concepts/02-architecture.md`](./concepts/02-architecture.md).)

---

## Step 2 — Copy and personalize `CLAUDE.md`

Copy [`templates/CLAUDE.md`](./templates/CLAUDE.md) to the repo root.

Open it and fill in the placeholders:

- `{{AGENT_NAME}}` — the agent's name (default: Robin).
- `{{USER_NAME}}` — the user's first name.
- `{{PROJECT_NAME}}` — the repo or project name.
- `{{VAULT_DIR}}` — your chosen `ROBIN_VAULT` directory name (default: `base`). This placeholder appears ~11× in `templates/CLAUDE.md` (and in `templates/README.md`). **Substitute every occurrence** — a literal copy that leaves `{{VAULT_DIR}}` in place will point the agent at paths that don't exist.

Do not change the structure. The file is intentionally short — its only job is to route a future agent session into the constitution.

> Across all templates you copy (CLAUDE.md, the constitution, the brain `_index.html` files, the skills), the recurring placeholders are `{{AGENT_NAME}}`, `{{USER_NAME}}`, `{{PROJECT_NAME}}`, and `{{VAULT_DIR}}`. A quick `grep -rl '{{' <copied-files>` after each step catches any you missed.

---

## Step 3 — Copy the constitution

Copy every file from [`templates/constitution/`](./templates/constitution/) into `.claude/constitution/` at the repo root. There are 14 files:

```
identity.md
guide.md
format.md
config.yaml
knowledgebase.md
learning.md
tasks.md
daily-rhythm.md
maintenance.md
writing.md
communications.md
conversation-style.md
retrieval.md
context-continuity.md
```

Personalize:

1. **`identity.md`** — replace `{{AGENT_NAME}}`, `{{USER_NAME}}`. Read the "strategic lenses" section near the bottom; either delete it (clean slate) or ask the user for two or three tensions they're actively navigating (e.g., "speed vs. polish", "depth vs. breadth"). Lenses are personal — fewer is better than vague.

2. **`config.yaml`** — every flag is a soft switch. Set to `false` by default. Turn on only what the user explicitly wants now. You can add more flags later; skills ignore unknown ones.

3. **`communications.md`** — the signature line ends with `— {{AGENT_NAME}} ({{USER_NAME}}'s agent)`. Update both placeholders. If the user has people who should *never* receive autonomous messages (manager, board, candidates), capture that list. Otherwise leave the section as a stub.

4. **Other files** — these are mostly structural and need no personalization. Read through them once to understand the design.

---

## Step 4 — Seed the brain

For each vault directory you created in Step 1, copy its `_index.html` from [`templates/brain/`](./templates/brain/) into the matching path under `<vault>/brain/`. (Only copy `_index.html` files for directories that actually exist — don't create the full taxonomy just to host index pages.)

These are minimal landing pages. They make the structure browsable from day one and give the agent visible "where things go" signals. Each is small enough to read top to bottom.

Then copy [`templates/brain/memory/events.jsonl`](./templates/brain/memory/events.jsonl) as an **empty** file to `<vault>/brain/memory/events.jsonl` (it must exist; the file is empty until `/learn` writes to it).

Open `<vault>/brain/_index.html` and replace `{{PROJECT_NAME}}` with the user's project name and `{{USER_NAME}}` where indicated.

**Seed the three append-only log files.** `doctor.sh` (Step 11) requires all three to exist under `<vault>/logs/`, and the skills append to them, so create them now — copy the templates (preferred; they ship with headers and entry-format docs) or `touch` empty files:

```bash
mkdir -p <vault>/logs
cp robin/gist/templates/logs/changelog.md  <vault>/logs/changelog.md
cp robin/gist/templates/logs/ingest-log.md <vault>/logs/ingest-log.md
cp robin/gist/templates/logs/repo-log.md   <vault>/logs/repo-log.md
# (or, for bare files: touch <vault>/logs/{changelog,ingest-log,repo-log}.md)
```

Without these three files, `make doctor` fails its `top-level logs exist` check on a fresh install.

---

## Step 5 — Drop in the example pages (optional but recommended)

Copy [`templates/examples/`](./templates/examples/) into a folder the user can reference (e.g., a `<vault>/brain/_examples/` folder, or just leave them in the gist as references).

These show the canonical page shape for each type: project, person, decision, hub, task, pattern. The user (and you, in future sessions) can copy them as starting points.

---

## Step 6 — Install the skills

For each skill folder in [`skills/`](./skills/) (other than `lib/`), copy its `SKILL.md` to `.claude/skills/<skill-name>/SKILL.md` at the repo root.

The minimum-viable set (essentials):

- `learn`
- `morning-brief`
- `remsleep`
- `ingest-source`
- `ingest-meeting`
- `lint-wiki`
- `check-tasks`
- `create-task`

The optional set (skip unless the user wants them):

- `check-calendar`, `check-slack`, `check-email` — require MCP integrations.
- `eod-signoff` — requires Slack MCP + GitHub CLI.

Also copy [`skills/lib/`](./skills/lib/) into `.claude/skills/lib/`. These are shared conventions (report template, provenance format) that the other skills reference.

Each skill has its own placeholders — search each `SKILL.md` for `{{` and fill in. Common ones:

- `{{AGENT_NAME}}`
- `{{USER_NAME}}`
- `{{USER_EMAIL}}`
- `{{TIMEZONE}}` (e.g., `Europe/Copenhagen`, `America/New_York`)
- `{{TEAM_CHANNEL_ID}}` (Slack — only if Slack MCP is enabled)
- `{{NOISE_SENDERS}}` (Email — only if Gmail MCP is enabled)

If an optional MCP isn't enabled, leave the skill in place but tell the user it won't work until they connect that MCP. Do not delete optional skills — they're useful later.

---

## Step 7 — Install the hooks

Copy [`templates/hooks/settings.json`](./templates/hooks/settings.json) to `.claude/settings.json`. It registers **two** hook scripts, so copy **both**:

- Copy [`templates/hooks/pre-compact.sh`](./templates/hooks/pre-compact.sh) to `.claude/hooks/pre-compact.sh` and `chmod +x` it. **(Required — `settings.json` references it under `PreCompact`. Forgetting this is the most common setup bug: compaction will error trying to run a missing script.)**
- Copy [`templates/hooks/daily-log.sh`](./templates/hooks/daily-log.sh) to `.claude/hooks/daily-log.sh` and `chmod +x` it.

The hooks do two things:

1. **PreCompact** (`pre-compact.sh`) — before the conversation is compressed, the hook checks the `.last-learn` sentinel. If `/learn` hasn't run in the past 30 minutes, it prints a non-blocking reminder. This is a nudge; it never blocks.
2. **SessionEnd** (`daily-log.sh`) — when the session ends, it appends a one-line record to `logs/daily/YYYY-MM-DD.md`.

**Point the hooks at your vault.** Both scripts default `VAULT="${CLAUDE_PROJECT_DIR:-$(pwd)}"` — i.e. the **repo root**. But `logs/` lives inside your vault (`<vault>/logs/`). So if your vault is a subdirectory (the recommended layout, e.g. `base/`), edit the `VAULT=` line in each script to append your vault dir:

```bash
VAULT="${CLAUDE_PROJECT_DIR:-$(pwd)}/<vault>"
```

The vault always lives under its own dir (default `base/`), so keep the hook `VAULT=` line pointed at `${CLAUDE_PROJECT_DIR:-$(pwd)}/<vault>`. Make the hook path and `ROBIN_VAULT` agree on where the vault is.

Both hooks are optional. If the user doesn't want them, skip this step — but if you copy `settings.json`, you must copy **both** scripts it references, or remove the unwanted entry from `settings.json`.

---

## Step 8 — Initial brain content (light touch)

Do **not** invent durable knowledge to fill the brain. Empty is fine.

But if the user has 5–10 minutes, ask them to dictate:

- One or two **decisions** they made recently (write to `<vault>/brain/decisions/YYYY-MM-DD-slug.html`).
- The names of the people they work with most (write minimal entries in `<vault>/brain/people/team/<first-last>.html`).
- The active projects they care about (one `_index.html` per project in `<vault>/brain/projects/<slug>/`).

Use the example pages in [`templates/examples/`](./templates/examples/) as shape templates. Keep each page short (a few paragraphs at most). The system rewards growth over time; do not front-load.

After each page, append a line to `<vault>/logs/changelog.md`:

```markdown
## [YYYY-MM-DD] create | seed page [[<slug>]]

Initial bootstrap content.
```

This is the user's first signal that the system has activity.

---

## Step 9 — Run a smoke test

Confirm the structure is wired correctly:

1. Ask the user to start a fresh session and type `/learn`. Even if nothing happened, `/learn` should run cleanly, write nothing, and exit with a "nothing durable this session" message. Verify it touched `<vault>/logs/.last-learn`.
2. Ask them to type `/check-tasks`. It should read `<vault>/brain/tasks/` and report an empty (or near-empty) list.
3. Ask them to type `/lint-wiki`. It should walk the brain and report no issues for a fresh setup.

If any of those fail, read the relevant `SKILL.md` and the constitution file the skill depends on. The most common errors are typos in placeholder substitution.

---

## Step 10 — Set up `.gitignore`

**If the user forked the starter repo, a root `.gitignore` already ships** — it keeps secrets and runtime state out of git while keeping `<vault>/brain/**` tracked. Verify it, and if the user chose a vault dir name other than `base/`, update the `base/...` paths in it to match. Then skip to Step 11.

If the user only has the gist (no fork), create the `.gitignore` yourself. At minimum, ignore (paths shown for a `base/` vault):

```gitignore
# Runtime sidecar — rebuildable index + rendered cache
<vault>/.robin/

# Secrets and env files (keep .env.example tracked)
.env
.env.*
!.env.example

# Node / build artifacts
node_modules/
robin/app/**/.next/
robin/app/**/dist/
robin/app/**/.turbo/

# Sensitive personal data — never commit
<vault>/inbox/contracts/

# Personal assets served to decks (keep local)
robin/app/apps/web/public/deck-assets/
```

Full guidance and rationale: [`customization.md`](./customization.md#gitignore-what-to-keep-out-of-git). Do **not** ignore canonical brain HTML — `<vault>/brain/**/*.html` must stay tracked.

---

## Step 11 — (Optional) Stand up the app

The lightweight, file-only flavor works now. If the user wants the **browser UI and indexed search**, follow [`app-setup.md`](./app-setup.md). In short:

1. `cp robin/app/apps/web/.env.example robin/app/apps/web/.env.local` and set **`ROBIN_VAULT`** to the absolute path of `<vault>`.
2. `cd robin/app && npm install`, then build the packages you need (e.g. `npm run build --workspace=@robin/mcp-server --workspace=@robin/indexer --workspace=@robin/converter`). Avoid the root `npm run build` until env is set — it also runs `apps/web`'s `next build`. See [`app-setup.md`](./app-setup.md) Step 2.
3. `make robin-ui` (or `cd robin/app/apps/web && ROBIN_VAULT=… npm run dev`) — serves on **`localhost:8400`**.
4. Add `.mcp.json` at the repo root — copy [`templates/mcp.json`](./templates/mcp.json) and replace `{{REPO_ROOT}}` (absolute path to the repo) and `{{VAULT_DIR}}` (your `<vault>` name). It points the `robin` MCP server at `robin/app/packages/mcp-server/dist/cli.js` with `ROBIN_VAULT` in `env`. Reconnect with `/mcp` after creating it.
5. Run `robin/scripts/doctor.sh` (or `make doctor`) to verify wiring.

Skills that call `mcp__robin__*` tools (e.g. `/check-tasks`, `/create-task`) need this MCP wired. Without it, fall back to direct file reads.

---

## Step 12 — Hand-off

Tell the user:

- Their entry point is **`CLAUDE.md`**. Every new agent session reads it.
- The daily rhythm is `/morning-brief` → work the day → `/learn` (before `/compact`) → `/remsleep` at the end.
- Capture goes into `<vault>/inbox/`. They drop transcripts, exported notes, screenshots into the right subfolder. Then they (or the agent) runs `/ingest-source` or `/ingest-meeting`.
- Durable knowledge lives in `<vault>/brain/`. They edit pages directly when needed, or ask the agent to.
- Polished outputs for sharing (slide decks, reports, plans for humans) live in `<vault>/out/`.
- `<vault>/logs/` is append-only — never delete entries.
- The two memory layers ([`concepts/05-two-memory-layers.md`](./concepts/05-two-memory-layers.md)) are subtle but important. Read it if anything in `/learn` or `/remsleep` feels confusing.
- **Before they ever share their own Robin**, they run the [`SCRUBBING.md`](./SCRUBBING.md) checklist to purge personal and company data.

Suggest they bookmark the [`concepts/`](./concepts/) folder. It is the reference manual.

---

## Common pitfalls

- **Editing pages outside `brain/` and expecting them to be retrieved.** Only `<vault>/brain/**/*.html` and active `<vault>/out/**/*.html` are canonical. Drafts, notes, scratch files must promote into `brain/` to be discoverable.
- **Treating Markdown as canonical.** Markdown is **input** (templates, inbox sources, append-only logs). The durable surface is HTML. Use the template HTML files when authoring; do not freely use `.md` in `brain/`.
- **Forgetting `pre-compact.sh`.** `settings.json` registers both hook scripts. If you copy `settings.json` but not `pre-compact.sh`, compaction errors. Copy both, or remove the entry.
- **Hook/vault path mismatch.** If your vault is `base/` but the hooks default `VAULT` to the repo root, the daily log and `.last-learn` land in the wrong place. Make the hook `VAULT=` line and `ROBIN_VAULT` agree (Step 7).
- **Skipping `state:` / `status:` on tasks.** Tasks need `<meta name="robin:status" content="open">` (not `state:`). The skills that surface tasks filter on `status`. See [`format/frontmatter-reference.md`](./format/frontmatter-reference.md).
- **Letting hubs go stale.** Hubs decay fast. If you don't reconcile them every couple of weeks, they lie. The `/remsleep` skill helps; treat its hub-staleness flags as real.
- **Hardcoding instead of config-ing.** Whenever you find yourself about to write a team member's name or a project slug into a SKILL.md, stop and put it in `config.yaml` instead.

---

## When in doubt

- The [`concepts/`](./concepts/) folder explains the *why* of every design decision.
- The [`format/`](./format/) folder is the contract spec — meta tag names, wikilink shape, memory event schema.
- The constitution files in [`templates/constitution/`](./templates/constitution/) are the agent's operating rules. They are written for the agent to read; they answer most "should I do X?" questions.

That's the setup. Start with Step 0. Confirm with the user before writing anything outside this folder.
