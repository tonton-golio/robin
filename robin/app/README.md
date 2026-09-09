# Robin UI

Local web UI + indexer + MCP server for Robin, your local second brain. Runs on `localhost:8400`. Plain HTML files in the vault. Sidecar SQLite index at `<vault>/.robin/index.db`.

Single user. Local-only by default. Authenticated remote access is an explicit
opt-in; see [Runtime security](#runtime-security).

## Layout

```
packages/
  converter/    Markdown import → canonical HTML pipeline
  indexer/      chokidar + SQLite (FTS5 + optional vectors)
  mcp-server/   Robin MCP stdio server for Claude Code skills (Phase 4)
  vault-io/     Durable writes, snapshots, receipts, lifecycle, and recovery
  shared/       Types and utilities shared across packages
apps/
  web/          Next.js 16 app (brain UI, interview, meeting) (Phase 3+)
tests/
  fixtures/     Playwright fixture vault
```

See [ROBIN_FORMAT.md](./ROBIN_FORMAT.md) for the file-format contract. v0.2
remains the producer default. v0.3 is a staged, explicit opt-in that adds an
immutable lowercase UUID and ordered typed-provenance pairs; normal writes will
not downgrade an adopted v0.3 page or replace its identity. Robin uses the
agentmemory pattern for recall: structured memory records are separate from
canonical HTML pages and are searched together with the page index.

Design docs live in [`docs/`](./docs/): [edit-log-ingest.md](./docs/edit-log-ingest.md) — the edit-anywhere · logged · back-steppable · ingestible editor redesign (proposed).

## Day and the agent overview

Day uses the same `loadOverview` projection as `GET /api/overview` for next
actions, review triggers, outcomes, watched commitments and meaningful changes.
Priority, checkpoint and path determine action order; the page does not run a
second task ranking. Tasks with a passed checkpoint, blocked state or missing
next action appear in review instead of both lanes; their recorded state and
next action remain intact. Full task controls remain on Tasks, and judgments on
Review. The response links back to canonical records and keeps page-update
times distinct from source-record dates; external-service coverage is unknown.

The API is read-only. Day retains its existing checkpoint-intervention pass,
then loads the overview so newly raised interventions appear on the same load.
Briefs, calendar snapshots, inbox items and edit receipts supplement that view.

## Vault durability and recovery

Canonical pages and append-only edit ledgers are durable data.
`<vault>/.history/` contains prior-byte snapshots; every snapshot referenced by
an edit event or pending receipt is retained. `pruneHistory` only thins
unreferenced snapshots: all through 30 days, newest per day through 90 days,
then newest per epoch week.

`<vault>/.robin/` is intentionally ignored but is not uniformly disposable:

- `index.db` is derived and rebuildable;
- locks are ephemeral coordination state and must not be removed while writers
  are active;
- `transactions/*.json` receipts and delete tombstones are critical
  crash-recovery evidence;
- `aliases.json` may contain operator-authored configuration.

Do not delete `.robin/` to clear a health error. Stop every writer, preserve a
copy of the vault, and use the proof-based flow:

```bash
robin/scripts/doctor.sh --report
npm --prefix robin/app run build --workspace=@robin/vault-io
node robin/app/packages/vault-io/dist/cli.js --vault base --json
# After reviewing the evidence:
node robin/app/packages/vault-io/dist/cli.js --vault base --repair --json
robin/scripts/doctor.sh
```

Inspection is read-only. `--repair` can only finalize a provably committed
event or clear its already-recorded receipt. It leaves `invalid` and
`incomplete` cases intact for manual reconciliation. Preserve their receipts,
tombstones, snapshots, and canonical files.

Git is version control and a replication mechanism, not backup. It does not
cover ignored receipts, uncommitted data, remote account loss, deleted refs, or
correlated corruption. Use a separately controlled backup and test restoring
the complete vault.

## Runtime security

The normal web commands bind both Next and the voice relay to numeric loopback
addresses. A centralized request guard also rejects non-loopback `Host` and
`Origin` values, including cross-site browser requests:

```bash
npm run dev --workspace=@robin/web
```

Do not expose that local mode through port forwarding or a reverse proxy.

Remote use is deliberately fail-closed. Configure all of the following in
`apps/web/.env.local`:

```dotenv
ROBIN_REMOTE_ACCESS=authenticated
ROBIN_API_TOKEN=<random secret of at least 32 characters>
ROBIN_PUBLIC_ORIGIN=https://robin.example.com
```

Then bind Next to a non-loopback interface explicitly instead of using the
default npm script. Put Robin behind a TLS reverse proxy which preserves the
public `Host` header. Browser access uses HTTP Basic authentication with
username `robin` and `ROBIN_API_TOKEN` as the password; API clients may instead
send `Authorization: Bearer <ROBIN_API_TOKEN>`.

The separate interview relay remains on `127.0.0.1` unless
`INTERVIEW_WS_HOST` is explicitly changed. A non-loopback relay bind is refused
unless authenticated remote mode is valid, and it should also be exposed only
through a TLS WebSocket proxy. Missing tokens, short tokens, invalid modes, and
missing/malformed public origins make the request boundary return `503` rather
than silently falling back to an open mode.

## Quick start

```bash
# Convert a single markdown import into canonical HTML:
cd packages/converter
npm install
npm run build
node dist/cli.js "/path/to/vault/inbox/example.md" > /tmp/example.html
open /tmp/index.html

# Bulk convert legacy markdown pages into canonical HTML siblings:
node dist/cli.js --batch "/path/to/vault"

# From robin/app, run the critical unit suite across every workspace:
cd ../..
npm test
```

### Opt in a reviewed page set to v0.3

The converter continues to emit v0.2. Build it, then run migration against the
vault root so each stored path is verified before a globally unique identity is
persisted. Start with an explicit, reviewed file set—never an automatic
whole-vault rewrite:

```bash
npm --prefix robin/app run build --workspace=@robin/converter
npm --prefix robin/app run build --workspace=@robin/vault-io
node robin/app/packages/converter/dist/cli.js migrate --to v0.3 base/brain/example.html --vault base --dry-run
node robin/scripts/migrate-page.mjs --vault base --to v0.3 base/brain/example.html --dry-run
node robin/scripts/migrate-page.mjs --vault base --to v0.3 base/brain/example.html --write
node robin/scripts/migrate-page.mjs --vault base --to v0.3 base/brain/example.html --check
```

Review and back up the selected pages before the write. `--check` is read-only
and exits non-zero when migration would still change a target. Migration also
requires exactly one canonical `<article data-robin-doc>`, exactly one non-empty
head title, and non-empty slug/type/updated metadata. Generic HTML is rejected
rather than silently converted into a Robin page. v0.3 is also limited to the executable page roots
declared in `robin/schemas/v1/contract.json`; inbox captures are outside that
contract. Directory runs are therefore intentionally strict.

The converter CLI only inventories directories and globs. The single-page
writer performs whole-file preflight, then uses the shared cross-process lock,
compare-and-swap hash, history snapshot, edit event, and recovery receipt.
It refuses stale converter/vault-io builds and aborts if the canonical article
hash changes.
A v0.3 JSON preview that needs a new identity reports
`preview_reproducible=false`: its UUID is intentionally ephemeral, and the
reviewed guarded write creates the durable UUID. The plan exposes the proposed
identity and typed source pairs and compares article hashes so the metadata
change is reviewable without pretending the random UUID is final.
