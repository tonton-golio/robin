/**
 * Public API for the @robin/indexer package.
 *
 * Usage:
 *   const idx = await createIndexer({ vaultPath: '/path/to/vault' });
 *   await idx.scan();
 *   const results = await idx.search('roadmap');
 *   idx.watch();
 *   idx.close();
 */

import path from 'path';
import { openDb } from './db.js';
import { scan, type ScanResult } from './scan.js';
import { search as doSearch } from './search.js';
import { Watcher } from './watcher.js';
import { runDecaySweep, ensureDecayColumns } from './decay-sweep.js';
import type { IndexerOptions, SearchHit, SearchOptions } from './types.js';
import type Database from 'better-sqlite3';

export type { IndexerOptions, SearchHit, SearchOptions, ScanResult };
export type { IndexedPage, LinkRecord, Tier } from './types.js';
export { parseRobinHtml } from './parse-html.js';
export type { ParsedPage } from './parse-html.js';
export { recomputeStaleness } from './search.js';
export { openDb, openInMemoryDb } from './db.js';
export { EMBEDDING_DIM } from './embeddings.js';
export { assignTier, computeRecency, computeFinalScore, computeStaleness } from './decay.js';
export { runDecaySweep, ensureDecayColumns } from './decay-sweep.js';

export interface Backlink {
  slug: string;
  path: string;
  title: string;
  type?: string;
}

export interface Indexer {
  /** One-shot full vault scan */
  scan(): Promise<ScanResult>;
  /** Start watching the vault for changes (long-running) */
  watch(): Watcher;
  /** Search the index */
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  /** Pages that link TO the given slug */
  getBacklinks(slug: string): Promise<Backlink[]>;
  /** Run decay sweep immediately */
  sweep(): number;
  /** The underlying SQLite database (for advanced use) */
  db: Database.Database;
  /** Close the database connection */
  close(): void;
}

/**
 * Create and initialize the Robin indexer.
 *
 * Opens (or creates) the SQLite database, applies migrations.
 * Does NOT scan immediately — call scan() or watch() to populate.
 */
/** Compute ms until the next 03:00 local time */
function msUntilNextSweep(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export async function createIndexer(opts: IndexerOptions): Promise<Indexer> {
  const { vaultPath, verbose = false } = opts;
  const dbPath = opts.dbPath ?? path.join(vaultPath, '.robin', 'index.db');

  const db = openDb(dbPath);

  // Ensure decay columns exist on every open (idempotent migration)
  ensureDecayColumns(db);

  let activeWatcher: Watcher | null = null;
  let nightlySweepTimer: ReturnType<typeof setTimeout> | null = null;

  /** Schedule (or reschedule) the nightly 03:00 sweep */
  function scheduleNightlySweep(): void {
    const delay = msUntilNextSweep();
    nightlySweepTimer = setTimeout(() => {
      try {
        const n = runDecaySweep(db);
        if (verbose) console.log(`[indexer] nightly sweep: updated ${n} pages`);
      } catch (err) {
        console.error('[indexer] nightly sweep failed:', err);
      }
      scheduleNightlySweep(); // reschedule for next night
    }, delay);
    // Allow Node to exit even if timer is pending
    if (nightlySweepTimer.unref) nightlySweepTimer.unref();
    if (verbose) {
      const h = Math.round(delay / 3600000);
      console.log(`[indexer] next decay sweep in ~${h}h`);
    }
  }

  scheduleNightlySweep();

  return {
    db,

    async scan(): Promise<ScanResult> {
      return scan(db, vaultPath, verbose);
    },

    watch(): Watcher {
      if (activeWatcher) {
        console.warn('[indexer] watch() called while already watching; returning existing watcher');
        return activeWatcher;
      }
      activeWatcher = new Watcher({ vaultPath, db, verbose });
      activeWatcher.start();
      return activeWatcher;
    },

    async search(query: string, searchOpts: SearchOptions = {}): Promise<SearchHit[]> {
      return doSearch(db, query, searchOpts);
    },

    async getBacklinks(slug: string): Promise<Backlink[]> {
      const rows = db
        .prepare(
          // Join on from_path (unique) so a backlink resolves to the EXACT source
          // page — joining on the non-unique from_slug fanned a single backlink
          // out across every same-slug page (all 24 `_index` hubs).
          `SELECT DISTINCT p.slug AS slug, p.path AS path, p.title AS title, p.type AS type
             FROM links l
             JOIN pages p ON p.path = l.from_path
            WHERE l.to_slug = ?
            ORDER BY p.title`
        )
        .all(slug) as Array<{ slug: string; path: string; title: string | null; type: string | null }>;
      return rows.map((r) => ({
        slug: r.slug,
        path: r.path,
        title: r.title ?? r.slug,
        type: r.type ?? undefined,
      }));
    },

    sweep(): number {
      return runDecaySweep(db);
    },

    close(): void {
      if (nightlySweepTimer) {
        clearTimeout(nightlySweepTimer);
        nightlySweepTimer = null;
      }
      if (activeWatcher) {
        activeWatcher.close().catch(console.error);
        activeWatcher = null;
      }
      db.close();
    },
  };
}
