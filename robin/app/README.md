# Robin UI

Local web UI + indexer + MCP server for Robin, your local second brain. Runs on `localhost:8400`. Plain HTML files in the vault. Sidecar SQLite index at `<vault>/.robin/index.db`.

Single user. No deployment. No auth.

## Layout

```
packages/
  converter/    Markdown import → canonical HTML pipeline
  indexer/      chokidar + SQLite (FTS5 + optional vectors)
  mcp-server/   Robin MCP stdio server for Claude Code skills (Phase 4)
  shared/       Types and utilities shared across packages
apps/
  web/          Next.js 16 app (brain UI, interview, meeting) (Phase 3+)
tests/
  fixtures/     Playwright fixture vault
```

See [ROBIN_FORMAT.md](./ROBIN_FORMAT.md) for the locked file format spec. Robin uses the agentmemory pattern for recall: structured memory records are separate from canonical HTML pages and are searched together with the page index.

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

# Run round-trip golden tests:
npm run test
```
