#!/usr/bin/env bash
# Robin vault doctor — health checks for the knowledge base.
#
# Severity tiers:
#   ERROR — a real correctness/integrity problem; fails the gate (exit != 0).
#   WARN  — a cosmetic nit or soft signal; reported but does NOT fail the gate.
#
# Vault location: read from $ROBIN_VAULT, else parsed from .mcp.json, else 'base'.
# Paths inside the vault are expressed relative to the vault root so an adopter
# with a different vault dir works unchanged.
set -uo pipefail

# ── repo root + vault resolution ────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

resolve_vault() {
  # 1) explicit env wins
  if [[ -n "${ROBIN_VAULT:-}" ]]; then printf '%s' "$ROBIN_VAULT"; return; fi
  # 2) parse .mcp.json (node, then a grep fallback) if present
  if [[ -f .mcp.json ]]; then
    local v=""
    if command -v node >/dev/null 2>&1; then
      v="$(node -e 'try{const c=require("./.mcp.json");process.stdout.write(c.mcpServers?.robin?.env?.ROBIN_VAULT||"")}catch{}' 2>/dev/null || true)"
    fi
    if [[ -z "$v" ]]; then
      # crude JSON grep fallback: first "ROBIN_VAULT": "..." value
      v="$(grep -o '"ROBIN_VAULT"[[:space:]]*:[[:space:]]*"[^"]*"' .mcp.json 2>/dev/null \
        | head -1 | sed 's/.*"ROBIN_VAULT"[[:space:]]*:[[:space:]]*"//;s/"$//' || true)"
    fi
    if [[ -n "$v" ]]; then printf '%s' "$v"; return; fi
  fi
  # 3) default
  printf '%s' "base"
}

VAULT_RAW="$(resolve_vault)"
# Normalise to a path relative to repo root when the vault lives inside it,
# so reports read 'brain/foo.html' regardless of how ROBIN_VAULT was spelled.
if [[ "$VAULT_RAW" = /* ]]; then
  case "$VAULT_RAW" in
    "$ROOT"/*) VAULT="${VAULT_RAW#"$ROOT"/}";;
    "$ROOT")   VAULT=".";;
    *)         VAULT="$VAULT_RAW";;  # vault outside repo — use absolute as-is
  esac
else
  VAULT="$VAULT_RAW"
fi

if [[ ! -d "$VAULT/brain" ]]; then
  echo "FATAL: resolved vault '$VAULT' has no brain/ (ROBIN_VAULT=${ROBIN_VAULT:-<unset>})" >&2
  exit 2
fi

# ── search-tool guard (rg preferred, grep -r fallback) ──────────────────────
if command -v rg >/dev/null 2>&1; then
  HAVE_RG=1
else
  HAVE_RG=0
  echo "WARN: ripgrep (rg) not found — falling back to grep -r (slower, less precise)." >&2
fi

# search_files PATTERN PATH [PATH...] -> prints "file:line:match", ERE, recursive.
search_files() {
  local pat="$1"; shift
  if [[ "$HAVE_RG" -eq 1 ]]; then
    rg -n --no-heading -e "$pat" "$@" 2>/dev/null || true
  else
    grep -rEn -e "$pat" "$@" 2>/dev/null || true
  fi
}

# ── harness ─────────────────────────────────────────────────────────────────
errors=0
warns=0

# check TIER NAME FN...  — TIER is ERROR or WARN.
check() {
  local tier="$1" name="$2"; shift 2
  echo "==> [$tier] $name"
  local out rc
  out="$("$@")"; rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "ok"
  else
    [[ -n "$out" ]] && printf '%s\n' "$out" | sed 's/^/    /'
    if [[ "$tier" == "ERROR" ]]; then
      echo "ERROR: $name" >&2
      errors=$((errors + 1))
    else
      echo "WARN: $name" >&2
      warns=$((warns + 1))
    fi
  fi
}

# ── shared page index (built once) ──────────────────────────────────────────
# The linkable knowledge tree only: brain/ inbox/ logs/ out/. We deliberately
# exclude repos/ and tools/ (and any .robin sidecar) — those hold node_modules,
# .venv and build artifacts that no wikilink ever targets and that would
# otherwise drown the ambiguous-slug signal in '404'/'index'/'tslib' noise.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
KNOWLEDGE_DIRS=()
for d in brain inbox logs out; do
  [[ -d "$VAULT/$d" ]] && KNOWLEDGE_DIRS+=("$VAULT/$d")
done
find "${KNOWLEDGE_DIRS[@]}" -type f -name '*.html' -not -path '*/.robin/*' 2>/dev/null \
  | while IFS= read -r f; do rel="${f#"$VAULT"/}"; printf '%s\n' "${rel%.html}"; done \
  | sort > "$TMP/paths"        # e.g. brain/risk-register, projects/beacon/beacon
sed 's#.*/##' "$TMP/paths" | sort > "$TMP/basenames_all"   # with dups
sort -u "$TMP/basenames_all" > "$TMP/basenames"            # unique

# Link targets used by the broken-link and orphan checks.
#
# Source of truth = data-wiki="…" attributes: these are the *rendered* links the
# app emits and the resolver consumes, so every unresolved one is a genuine dead
# link. We deliberately do NOT treat raw [[…]] occurrences in HTML as links here:
# in this vault they appear inside prose, robin:summary meta text and standards
# docs as examples/placeholders ({slug}, new-slug) or as cross-references to the
# auto-memory layer — none of which are rendered links, so counting them produced
# false positives. (The converter is what turns authored [[…]] into data-wiki, so
# data-wiki is the post-conversion, authoritative set.)
#
# mem_* targets are valid pointers into brain/memory/events.jsonl, not pages, and
# are filtered out so they never count as broken.
collect_targets() {
  {
    if [[ "$HAVE_RG" -eq 1 ]]; then
      rg -o 'data-wiki="[^"]*"' "$VAULT/brain" --no-filename 2>/dev/null | sed 's/data-wiki="//;s/"$//'
    else
      grep -rho 'data-wiki="[^"]*"' "$VAULT/brain" 2>/dev/null | sed 's/data-wiki="//;s/"$//'
    fi
  } | sed 's/\.html$//' \
    | grep -vE '^(mem_|\{|new-slug$|hub-slug$|slug$)' \
    | sort -u
}
collect_targets > "$TMP/targets"

# resolves_ref REF -> 0 if it resolves to a page, 1 otherwise.
# Mirrors robin/app/.../resolve.ts: path-like refs match a vault-relative path
# exactly or by '/suffix'; bare slugs match an .html basename anywhere.
resolves_ref() {
  local ref="$1"
  if [[ "$ref" == */* ]]; then
    grep -qE "(^|/)$(printf '%s' "$ref" | sed 's/[.[\*^$]/\\&/g')\$" "$TMP/paths"
  else
    grep -qxF "$ref" "$TMP/basenames"
  fi
}

# ════════════════════════════════════════════════════════════════════════════
# ERROR-tier checks (must hold; fail the gate)
# ════════════════════════════════════════════════════════════════════════════

# Stale/leaked path references. The old denylist flagged legitimate dirs
# (brain/strategy/, brain/about_user/); here we only catch genuine leaks:
#   - absolute /Users/<user>/(brain|inbox|out|notes) vault paths
#   - legacy [[artifacts/raw/user_notes …]] wikilink prefixes
check_no_stale_paths() {
  local matches
  matches="$(search_files \
    '/Users/[^/]+/(brain|inbox|out|notes)/|\[\[(artifacts|raw|user_notes)/|`(artifacts|raw|user_notes)/' \
    CLAUDE.md .claude "$VAULT/brain" "$VAULT/inbox" "$VAULT/out" 2>/dev/null \
    | grep -v 'settings.local.json' \
    | grep -v 'logs/ingest-log.md' || true)"
  [[ -z "$matches" ]] || { printf '%s' "$matches"; return 1; }
}

# Every brain/*.html carries the v0.2 format contract:
#   <meta name="robin:type">, <meta name="robin:updated">, <article data-robin-doc>,
#   and NO legacy v0.1 JSON <script> blocks.
check_format_contract() {
  local bad="" f
  while IFS= read -r f; do
    grep -q '<meta name="robin:type"'    "$f" || bad+="$f: missing robin:type"$'\n'
    grep -q '<meta name="robin:updated"' "$f" || bad+="$f: missing robin:updated"$'\n'
    grep -q 'data-robin-doc'             "$f" || bad+="$f: missing <article data-robin-doc>"$'\n'
    grep -q '<script type="application/json"' "$f" && bad+="$f: legacy v0.1 JSON <script> block"$'\n'
  done < <(find "$VAULT/brain" -name '*.html' -type f)
  [[ -z "$bad" ]] || { printf '%s' "$bad"; return 1; }
}

# Broken wikilinks: every referenced target must resolve to a page.
# The single highest-value integrity signal.
check_broken_wikilinks() {
  local bad="" t
  while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    resolves_ref "$t" || bad+="dangling -> $t"$'\n'
  done < "$TMP/targets"
  [[ -z "$bad" ]] || { printf '%s' "$bad"; return 1; }
}

# Ambiguous slugs: two pages sharing a basename make bare-slug links ambiguous.
# '_index' is exempt — every dir has one and they resolve by path, not slug.
check_ambiguous_slugs() {
  local dups
  dups="$(uniq -d "$TMP/basenames_all" | grep -vxF '_index' || true)"
  [[ -z "$dups" ]] && return 0
  local bad="" d
  while IFS= read -r d; do
    bad+="ambiguous slug '$d':"$'\n'
    bad+="$(grep -E "(^|/)$(printf '%s' "$d" | sed 's/[.[\*^$]/\\&/g')\$" "$TMP/paths" | sed 's/^/  /')"$'\n'
  done <<< "$dups"
  printf '%s' "$bad"; return 1
}

# Generated artifacts ignored; canonical brain HTML tracked.
check_generated_ignored() {
  git check-ignore "$VAULT/.robin/index.db" >/dev/null 2>&1 || { echo "$VAULT/.robin/index.db should be gitignored"; return 1; }
  if git check-ignore "$VAULT/brain/_index.html" >/dev/null 2>&1; then
    echo "$VAULT/brain/_index.html must be tracked, not ignored"; return 1
  fi
}

# MCP config points at a real vault containing brain/. Prefers node to parse
# .mcp.json; falls back to a grep parser when node is unavailable.
# A missing .mcp.json is the lightweight (file-only) flavor — a valid state, not
# a wiring error — so skip cleanly. When .mcp.json exists, validate it strictly.
check_mcp() {
  if [[ ! -f .mcp.json ]]; then
    echo "no .mcp.json — lightweight flavor; see robin/gist/app-setup.md to add the app + MCP" >&2
    return 0
  fi
  local cli vault
  if command -v node >/dev/null 2>&1; then
    cli="$(node -e 'try{const c=require("./.mcp.json");process.stdout.write(c.mcpServers.robin.args[0])}catch{}' 2>/dev/null || true)"
    vault="$(node -e 'try{const c=require("./.mcp.json");process.stdout.write(c.mcpServers.robin.env.ROBIN_VAULT)}catch{}' 2>/dev/null || true)"
  else
    cli="$(grep -oE '"args"[[:space:]]*:[[:space:]]*\[[[:space:]]*"[^"]*"' .mcp.json | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
    vault="$(grep -o '"ROBIN_VAULT"[[:space:]]*:[[:space:]]*"[^"]*"' .mcp.json | head -1 | sed 's/.*"ROBIN_VAULT"[[:space:]]*:[[:space:]]*"//;s/"$//')"
  fi
  [[ -n "$cli" && -f "$cli" ]] || { echo "missing MCP CLI: ${cli:-<unset>}"; return 1; }
  [[ -n "$vault" && -d "$vault/brain" ]] || { echo "ROBIN_VAULT has no brain/: ${vault:-<unset>}"; return 1; }
}

# Skill SKILL.md files start with YAML frontmatter at byte 0.
check_skill_frontmatter() {
  local bad="" file
  while IFS= read -r -d '' file; do
    [[ "$(head -n 1 "$file")" == "---" ]] || bad+="$file: no YAML frontmatter at byte 0"$'\n'
  done < <(find .claude/skills -name 'SKILL.md' -print0 2>/dev/null)
  [[ -z "$bad" ]] || { printf '%s' "$bad"; return 1; }
}

# brain/ is HTML-only (no markdown pages).
check_no_brain_markdown() {
  local m; m="$(find "$VAULT/brain" -name '*.md' -print)"
  [[ -z "$m" ]] || { printf '%s' "$m"; return 1; }
}

# Archived tasks must be closed. Status-aware: accepts robin:status (canonical)
# OR legacy robin:state, flagging any still-active value in the archive.
check_archived_tasks() {
  [[ -d "$VAULT/brain/tasks/archive" ]] || return 0
  local m
  m="$(search_files \
    'name="robin:(state|status)"[^>]*content="(open|in-progress|in_progress|pending|blocked|active|todo|doing)"' \
    "$VAULT/brain/tasks/archive" 2>/dev/null || true)"
  [[ -z "$m" ]] || { printf '%s' "$m"; return 1; }
}

# Top-level operational logs exist.
check_logs_exist() {
  local missing=""
  for f in changelog.md ingest-log.md repo-log.md; do
    [[ -f "$VAULT/logs/$f" ]] || missing+="missing $VAULT/logs/$f"$'\n'
  done
  [[ -z "$missing" ]] || { printf '%s' "$missing"; return 1; }
}

# Repo .env files are gitignored (secrets must not be tracked).
check_env_ignored() {
  local bad="" file
  while IFS= read -r -d '' file; do
    [[ "$file" == *.example ]] && continue
    git check-ignore "$file" >/dev/null 2>&1 || bad+="$file is not gitignored"$'\n'
  done < <(find "$VAULT/repos" "$VAULT/tools" robin/app \( -name '.env' -o -name '.env.*' \) -print0 2>/dev/null)
  [[ -z "$bad" ]] || { printf '%s' "$bad"; return 1; }
}

# out/ contains only HTML pages + image/asset files (no stray .md or other cruft).
# Images (png/jpg/jpeg/svg/gif/webp) for decks/storyboards are allowed.
# Gitignored files (e.g. .DS_Store) are OS cruft, never part of the durable
# vault, and are skipped so they don't fail the gate.
check_out_html_only() {
  [[ -d "$VAULT/out" ]] || return 0
  local bad="" f
  while IFS= read -r f; do
    git check-ignore "$f" >/dev/null 2>&1 && continue   # skip gitignored cruft
    bad+="$f"$'\n'
  done < <(find "$VAULT/out" -type f \
        ! -name '*.html' ! -name '.gitkeep' \
        ! -iname '*.png' ! -iname '*.jpg' ! -iname '*.jpeg' \
        ! -iname '*.svg' ! -iname '*.gif' ! -iname '*.webp' \
        -print)
  [[ -z "$bad" ]] || { printf '%s' "$bad"; return 1; }
}

# ════════════════════════════════════════════════════════════════════════════
# WARN-tier checks (soft signals; reported but do not fail the gate)
# ════════════════════════════════════════════════════════════════════════════

# Orphan pages: brain pages with no inbound link. Excludes _index pages and
# hubs/ (entry points are linked-from-nowhere by design).
check_orphans() {
  local orphans="" f rel relnoext base
  # Pre-split path-like targets for the suffix test.
  grep '/' "$TMP/targets" > "$TMP/path_targets" || true
  while IFS= read -r f; do
    rel="${f#"$VAULT"/}"; relnoext="${rel%.html}"; base="${relnoext##*/}"
    [[ "$base" == "_index" ]] && continue
    case "$relnoext" in brain/hubs/*) continue;; esac
    # linked by bare slug?
    grep -qxF "$base" "$TMP/targets" && continue
    # linked by a path-like target (exact or '/suffix')?
    if grep -qE "(^|/)$(printf '%s' "$relnoext" | sed 's#brain/##;s/[.[\*^$]/\\&/g')\$" "$TMP/path_targets"; then
      continue
    fi
    if grep -qxF "$relnoext" "$TMP/path_targets" 2>/dev/null; then continue; fi
    orphans+="$relnoext"$'\n'
  done < <(find "$VAULT/brain" -name '*.html' -type f)
  [[ -z "$orphans" ]] && return 0
  printf 'no inbound links (%d):\n%s' "$(printf '%s' "$orphans" | grep -c .)" "$orphans"
  return 1
}

# Index freshness: the search index should be at least as new as the newest
# brain HTML. A stale index means MCP/UI search returns outdated results.
check_index_fresh() {
  local db="$VAULT/.robin/index.db"
  [[ -f "$db" ]] || { echo "no index.db at $db (run the indexer)"; return 1; }
  local db_m newest_m newest_f age
  db_m="$(stat -f %m "$db" 2>/dev/null || stat -c %Y "$db" 2>/dev/null)"
  newest_f="$(find "$VAULT/brain" -name '*.html' -type f -exec stat -f '%m %N' {} \; 2>/dev/null \
              | sort -rn | head -1)"
  if [[ -z "$newest_f" ]]; then
    newest_f="$(find "$VAULT/brain" -name '*.html' -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1)"
  fi
  newest_m="${newest_f%% *}"; newest_m="${newest_m%.*}"
  [[ -z "$newest_m" ]] && return 0
  if [[ "$db_m" -ge "$newest_m" ]]; then return 0; fi
  age=$(( newest_m - db_m ))
  echo "index.db is stale by ${age}s; newest brain page: ${newest_f#* }"
  echo "  (rebuild the index so search reflects current brain content)"
  return 1
}

# out/ markdown is a soft housekeeping nit (generated artifacts belong as HTML).
check_no_out_markdown() {
  [[ -d "$VAULT/out" ]] || return 0
  local m; m="$(find "$VAULT/out" -name '*.md' -print)"
  [[ -z "$m" ]] || { printf '%s' "$m"; return 1; }
}

# ── run ─────────────────────────────────────────────────────────────────────
echo "Robin doctor — vault: $VAULT (rg=$([[ $HAVE_RG -eq 1 ]] && echo yes || echo no))"
echo

# ERROR tier
check ERROR "no leaked/stale paths"                 check_no_stale_paths
check ERROR "brain format contract (v0.2)"          check_format_contract
check ERROR "no broken wikilinks"                   check_broken_wikilinks
check ERROR "no ambiguous slugs"                    check_ambiguous_slugs
check ERROR "generated ignored, brain tracked"      check_generated_ignored
check ERROR "MCP config points at a real vault"     check_mcp
check ERROR "skill frontmatter at byte 0"           check_skill_frontmatter
check ERROR "brain has no markdown pages"           check_no_brain_markdown
check ERROR "archived tasks are closed"             check_archived_tasks
check ERROR "top-level logs exist"                  check_logs_exist
check ERROR "repo .env files are ignored"           check_env_ignored
check ERROR "out is html + assets only"             check_out_html_only

# WARN tier
check WARN  "no orphan pages"                        check_orphans
check WARN  "search index is fresh"                  check_index_fresh
check WARN  "out has no markdown"                    check_no_out_markdown

echo
echo "Summary: $errors error(s), $warns warning(s)."
[[ "$errors" -eq 0 ]] && echo "Gate: PASS (warnings do not fail)" || echo "Gate: FAIL"
exit "$errors"
