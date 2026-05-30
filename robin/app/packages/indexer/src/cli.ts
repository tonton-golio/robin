#!/usr/bin/env node
/**
 * CLI for the Robin indexer.
 *
 * Commands:
 *   robin-indexer scan <vault>             — one-shot full scan
 *   robin-indexer watch <vault>            — scan + watch (long-running)
 *   robin-indexer search "query" --vault /path  — debug search
 */

import path from 'path';
import process from 'process';
import { createIndexer } from './index.js';
import { runDecaySweep, ensureDecayColumns } from './decay-sweep.js';
import { openDb } from './db.js';

function usage(): void {
  console.error(`
robin-indexer — Robin vault indexer

Commands:
  scan <vault>                        One-shot scan of all .html files
  watch <vault>                       Scan + watch for changes (long-running)
  search <query> --vault <vault>      Debug search query
  sweep <vault>                       Run decay sweep (recompute staleness)

Options:
  --verbose, -v                       Enable verbose logging
  --db <path>                         Custom path to index.db
  --k <n>                             Number of search results (default 20)

Examples:
  robin-indexer scan /path/to/vault
  robin-indexer watch /path/to/vault
  robin-indexer search "roadmap" --vault /path/to/vault
  robin-indexer sweep /path/to/vault
`);
}

function parseArgs(argv: string[]): {
  command: string;
  vault: string | null;
  query: string | null;
  verbose: boolean;
  dbPath: string | undefined;
  k: number;
} {
  const args = argv.slice(2); // strip 'node' and script path
  const command = args[0] ?? '';
  let vault: string | null = null;
  let query: string | null = null;
  let verbose = false;
  let dbPath: string | undefined;
  let k = 20;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--vault' && args[i + 1]) {
      vault = path.resolve(args[++i]!);
    } else if (arg === '--db' && args[i + 1]) {
      dbPath = path.resolve(args[++i]!);
    } else if (arg === '--k' && args[i + 1]) {
      k = parseInt(args[++i]!, 10) || 20;
    } else if (!arg.startsWith('--')) {
      // Positional: vault for scan/watch/sweep, query for search
      if (command === 'scan' || command === 'watch' || command === 'sweep') {
        vault = vault ?? path.resolve(arg);
      } else if (command === 'search') {
        query = query ?? arg;
      }
    }
  }

  return { command, vault, query, verbose, dbPath, k };
}

async function main(): Promise<void> {
  const { command, vault, query, verbose, dbPath, k } = parseArgs(process.argv);

  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exit(0);
  }

  if (command === 'scan') {
    if (!vault) {
      console.error('Error: vault path required for scan command');
      usage();
      process.exit(1);
    }

    const indexer = await createIndexer({ vaultPath: vault, verbose, dbPath });
    console.log(`Scanning vault: ${vault}`);
    console.log(`Database: ${dbPath ?? path.join(vault, '.robin', 'index.db')}`);

    const result = await indexer.scan();
    console.log(
      `\nIndexed ${result.indexed} pages, ${result.wikilinks} wikilinks, ${result.ambiguous} ambiguous slugs.`
    );
    if (result.errors > 0) {
      console.warn(`  ${result.errors} files had errors.`);
    }

    indexer.close();
    process.exit(0);
  }

  if (command === 'watch') {
    if (!vault) {
      console.error('Error: vault path required for watch command');
      usage();
      process.exit(1);
    }

    const indexer = await createIndexer({ vaultPath: vault, verbose: true, dbPath });
    console.log(`Scanning vault: ${vault}`);
    const result = await indexer.scan();
    console.log(
      `\nInitial scan: ${result.indexed} pages, ${result.wikilinks} wikilinks, ${result.ambiguous} ambiguous slugs.`
    );

    indexer.watch();
    console.log('\nWatching for changes... (Ctrl+C to stop)\n');

    // Keep alive
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      indexer.close();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      indexer.close();
      process.exit(0);
    });

    return; // Don't exit
  }

  if (command === 'sweep') {
    if (!vault) {
      console.error('Error: vault path required for sweep command');
      usage();
      process.exit(1);
    }

    const sweepDbPath = dbPath ?? path.join(vault, '.robin', 'index.db');
    const db = openDb(sweepDbPath);
    ensureDecayColumns(db);
    const n = runDecaySweep(db);
    console.log(`Updated ${n} pages.`);
    db.close();
    process.exit(0);
  }

  if (command === 'search') {
    if (!query) {
      console.error('Error: query string required for search command');
      usage();
      process.exit(1);
    }
    if (!vault) {
      console.error('Error: --vault path required for search command');
      usage();
      process.exit(1);
    }

    const indexer = await createIndexer({ vaultPath: vault, dbPath });
    const hits = await indexer.search(query, { k });

    if (hits.length === 0) {
      console.log(`No results for: "${query}"`);
    } else {
      console.log(`\nResults for: "${query}" (${hits.length} hits)\n`);
      for (const hit of hits) {
        console.log(`  [${hit.score.toFixed(4)}] ${hit.slug}`);
        if (hit.title) console.log(`           ${hit.title}`);
        if (hit.snippet) console.log(`           ${hit.snippet}`);
        console.log();
      }
    }

    indexer.close();
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
