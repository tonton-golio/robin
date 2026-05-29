# Scrubbing checklist — before you share your own Robin

Robin's whole value is that it accumulates *your* private context: who you work with, what they earn, which channels you watch, what your company is building. That is exactly what must **not** leak when you share the framework, publish a fork, or hand a teammate your repo.

The vault/framework split (see [`concepts/02-architecture.md`](./concepts/02-architecture.md#the-top-level-split-vault-vs-framework)) is the structural defense: share `robin/` (the framework), keep your vault (`base/`, or whatever your `ROBIN_VAULT` points at) private. This checklist is the manual defense for the leaks the split alone doesn't catch — hardcoded strings inside the framework, and anything you forgot to gitignore.

Run this **before any share**.

---

## 1. Keep the vault out of what you share

- [ ] If sharing only the framework: share `robin/` (and the gist), **not** your vault directory. The vault holds all personal data.
- [ ] Confirm `.gitignore` excludes the runtime sidecar (`<vault>/.robin/`), `.env*` (except `.env.example`), `<vault>/inbox/contracts/`, and any personal asset dirs. See [`customization.md`](./customization.md#gitignore-what-to-keep-out-of-git).
- [ ] `git ls-files | grep -i contract` and similar — confirm nothing sensitive is *already tracked*. Gitignore does not retroactively remove committed files; use `git rm --cached` (and rewrite history if it was ever pushed).

## 2. Purge company and product names

- [ ] Set org/product terms via env, not code: `ROBIN_ORG` and the comma-separated `ROBIN_ORG_GLOSSARY` in `.env.local` (the meeting keyterms read these via `lib/config.ts`; they default to empty/`Robin`, so the framework ships clean). Then grep the framework anyway for stray real names: `rg -i "<your-company>|<your-product>"`.
- [ ] Grep the gist and constitution templates for any real org names that crept into examples: `rg -i "<your-company>|<your-product>"`.
- [ ] Check `out/` artifacts and `logs/` — these are full of real names by nature. They live in the vault; just confirm the vault isn't in the share.

## 3. Purge real Slack channel IDs and integration handles

- [ ] Remove real channel IDs (e.g. `C0XXXXXXXX`) from `config.yaml`, skill files, and any committed memory. They belong only in *your* private `config.yaml`, as placeholders (`{{TEAM_CHANNEL_ID}}`) in anything shared.
- [ ] Remove real Gmail noise-sender lists, calendar IDs, and any webhook/relay URLs.
- [ ] Confirm no API keys are anywhere but `.env.local` (gitignored). `rg -n "sk-|xai-|Bearer " robin/ .claude/` should come back empty in tracked files.

## 4. Purge salary, contract, and comp data

- [ ] `<vault>/inbox/contracts/` must be gitignored and never shared.
- [ ] Grep brain + memory + out for compensation: `rg -in "salary|bonus|pension|comp|DKK|EUR|€|\$[0-9]"` and confirm none of those pages are in the shared surface.
- [ ] Comp figures often live in `brain/people/team/*` and `brain/strategy/*` — these stay in the private vault.

## 5. Purge stakeholder and team names

- [ ] `brain/people/` (team, stakeholders, candidates) is personal data — vault only.
- [ ] In anything shared, replace real names with placeholders (`{{USER_NAME}}`, generic role names). The gist templates already use placeholders; keep it that way.
- [ ] Candidate/hiring records are especially sensitive — never share `brain/people/candidates/`.

## 6. Reset owner/org identity to placeholders

- [ ] App identity is env-driven and ships clean: keep `ROBIN_OWNER` / `ROBIN_ORG` / `ROBIN_ORG_GLOSSARY` / `NEXT_PUBLIC_ROBIN_OWNER` in your gitignored `.env.local`, never in tracked files. The Claude Code side — `CLAUDE.md` and `.claude/constitution/identity.md` — does carry identity in-file, so set those to `{{USER_NAME}}` / `{{AGENT_NAME}}` placeholders before sharing the *framework*.
- [ ] Set runtime identity via env where the system supports it (`ROBIN_VAULT`, `ASSISTANT_CLAUDE_CWD`) — never hardcode absolute personal paths into shared files. The shipped `Makefile` and `doctor.sh` contain the author's absolute `base/` path; parameterize or note them before sharing.

## 7. Rename the personal `about_*` directory

- [ ] The brain has a directory for personal context about the primary user. This kit ships it as **`about_user/`** as the generic convention. In a live setup you may have renamed it to `about_<you>`.
- [ ] **The directory basename itself is a personalization point** — it encodes a name. Before sharing, rename it back to the generic `about_user/` (or strip it from the share), and update any references in `brain/_index.html`, hubs, and wikilinks.

## 8. Final sweep

- [ ] `rg -n "/Users/<your-username>/" robin/ .claude/ CLAUDE.md Makefile` — replace personal absolute paths with placeholders or relative references where shared.
- [ ] Run `make doctor` — it flags stale path prefixes and unignored secrets/env files.
- [ ] Skim `git diff` of what you're about to push one more time, looking specifically for names, money, and channel IDs.

When in doubt, leave it out. It is far cheaper to under-share the framework than to leak the vault.
