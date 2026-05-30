#!/usr/bin/env node
/**
 * CLI entry point for the Robin MCP server.
 *
 * Usage:
 *   robin-mcp [--vault <path>] [--probe]
 *
 * --vault: override ROBIN_VAULT
 * --probe: print tool list as JSON and exit (for sanity-checking)
 */

import * as path from 'node:path';
import { startServer, getToolList } from './server.js';
import type { ToolContext, IndexerHandle } from './types.js';

// No-env fallback only. Real runs always set ROBIN_VAULT (via .env.local /
// .mcp.json / Makefile) or pass --vault; point it at your vault's absolute path.
const DEFAULT_VAULT = path.join(process.cwd(), 'base');

function parseArgs(argv: string[]): { vault: string; probe: boolean } {
  let vault = process.env['ROBIN_VAULT'] ?? DEFAULT_VAULT;
  let probe = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--vault' && argv[i + 1]) {
      vault = argv[++i]!;
    } else if (arg === '--probe') {
      probe = true;
    }
  }

  return { vault, probe };
}

async function openIndexer(vaultPath: string): Promise<IndexerHandle | null> {
  try {
    const { createIndexer } = await import('@robin/indexer');
    const indexer = await createIndexer({ vaultPath });
    // Scan on startup so the DB is populated before handling requests.
    // This is a one-shot full vault scan; watch() is not started here.
    try {
      process.stderr.write('[robin-mcp] Scanning vault index...\n');
      await indexer.scan();
      process.stderr.write('[robin-mcp] Vault index scan complete.\n');
    } catch (scanErr) {
      const msg = scanErr instanceof Error ? scanErr.message : String(scanErr);
      process.stderr.write(`[robin-mcp] WARNING: Index scan failed — index may be stale. Cause: ${msg}\n`);
    }
    return {
      db: indexer.db,
      search: (query, opts) => indexer.search(query, opts as Parameters<typeof indexer.search>[1]),
      scan: () => indexer.scan(),
      close: () => indexer.close(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[robin-mcp] WARNING: Failed to open indexer — running in no-index mode. ` +
        `Search will return 503 and slug lookup will use filesystem only.\n` +
        `Cause: ${msg}\n`
    );
    return null;
  }
}

async function main() {
  const { vault, probe } = parseArgs(process.argv.slice(2));

  if (probe) {
    const tools = getToolList();
    process.stdout.write(JSON.stringify({ tools }, null, 2) + '\n');
    process.exit(0);
  }

  process.stderr.write(`[robin-mcp] Starting. vault=${vault}\n`);

  const indexer = await openIndexer(vault);
  const ctx: ToolContext = { vaultPath: vault, indexer };

  // Graceful shutdown
  const cleanup = () => {
    if (indexer) indexer.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  process.stderr.write(
    `[robin-mcp] Indexer: ${indexer ? 'loaded' : 'no-index mode'}. Ready.\n`
  );

  await startServer(ctx);
}

main().catch((err) => {
  process.stderr.write(`[robin-mcp] Fatal error: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
