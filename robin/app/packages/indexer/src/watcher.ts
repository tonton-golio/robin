/**
 * File-system watcher for the Robin vault.
 *
 * Uses chokidar to watch canonical .html files under brain/ and out/.
 * Includes a self-write filter: when Robin itself writes a file, it calls
 * notifyWroteFile() to suppress the resulting change event for 500ms.
 * This prevents access-counter pollution from canonical saves.
 */

import chokidar from 'chokidar';
import path from 'path';
import type Database from 'better-sqlite3';
import { indexFile, recomputeWikilink, hasVecTable } from './index-file.js';

export type WatchEvent = 'add' | 'change' | 'unlink';
export type WatchCallback = (event: WatchEvent, filePath: string) => void;

export class Watcher {
  private readonly vaultPath: string;
  private readonly db: Database.Database;
  private readonly onEvent?: WatchCallback;
  private readonly verbose: boolean;

  /** path → expiry timestamp (ms). If expiry > now, ignore the next event. */
  private readonly recentlyWrittenByUs = new Map<string, number>();

  private watcher: ReturnType<typeof chokidar.watch> | null = null;

  // Serialize all indexing work onto a single promise chain. chokidar fires
  // listeners fire-and-forget (it does not await them) and indexFile yields at
  // its `await embed(...)` between the pages upsert and the links DELETE/reinsert.
  // Two events for pages sharing a slug (e.g. two `_index.html`) could otherwise
  // interleave across that await, the later call's slug-keyed DELETE clobbering
  // the earlier call's just-written links. Chaining guarantees one indexFile /
  // unlink runs to completion at a time.
  private indexChain: Promise<void> = Promise.resolve();

  constructor(opts: {
    vaultPath: string;
    db: Database.Database;
    onEvent?: WatchCallback;
    verbose?: boolean;
  }) {
    this.vaultPath = opts.vaultPath;
    this.db = opts.db;
    this.onEvent = opts.onEvent;
    this.verbose = opts.verbose ?? false;
  }

  /**
   * Notify the watcher that WE are about to write (or just wrote) a file.
   * The next chokidar event for this path within 500ms will be silently ignored.
   */
  notifyWroteFile(filePath: string): void {
    this.recentlyWrittenByUs.set(filePath, Date.now() + 500);
  }

  /** Returns true if the event for this path should be suppressed. */
  private shouldIgnore(filePath: string): boolean {
    const exp = this.recentlyWrittenByUs.get(filePath);
    if (exp === undefined) return false;
    if (exp > Date.now()) return true;
    // Expired — clean up
    this.recentlyWrittenByUs.delete(filePath);
    return false;
  }

  /** Start watching. Returns this for chaining. */
  start(): this {
    const patterns = [
      path.join(this.vaultPath, 'brain', '**', '*.html'),
      path.join(this.vaultPath, 'out', '**', '*.html'),
    ];

    this.watcher = chokidar.watch(patterns, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (filePath: string) => this.handleEvent('add', filePath));
    this.watcher.on('change', (filePath: string) => this.handleEvent('change', filePath));
    this.watcher.on('unlink', (filePath: string) => this.handleUnlink(filePath));
    this.watcher.on('error', (err: unknown) => {
      console.error('[watcher] error:', err);
    });

    if (this.verbose) {
      console.log(`[watcher] watching ${patterns.join(', ')}`);
    }

    return this;
  }

  private async handleEvent(event: WatchEvent, filePath: string): Promise<void> {
    if (this.shouldIgnore(filePath)) {
      if (this.verbose) console.log(`[watcher] ignoring self-write: ${filePath}`);
      return;
    }

    if (this.verbose) console.log(`[watcher] ${event}: ${filePath}`);

    // Serialize onto the shared chain so indexFile's pages-upsert →
    // recomputeWikilink → await embed → links DELETE/reinsert sequence completes
    // atomically with respect to other events (no cross-page slug clobber).
    this.indexChain = this.indexChain
      .then(() => indexFile(this.db, filePath, this.vaultPath))
      .catch((err) => {
        console.error(`[watcher] index failed for ${filePath}:`, err);
      });
    await this.indexChain;

    this.onEvent?.(event, filePath);
  }

  private async handleUnlink(filePath: string): Promise<void> {
    if (this.shouldIgnore(filePath)) return;
    if (this.verbose) console.log(`[watcher] unlink: ${filePath}`);

    const relPath = path.relative(this.vaultPath, filePath);
    // Serialize the unlink cleanup on the same chain as indexing so it cannot
    // interleave with an in-flight indexFile (which awaits embed mid-sequence).
    this.indexChain = this.indexChain
      .then(() => {
        // Read rowid + slug BEFORE deleting the page — the rowid is needed to
        // drop the matching embedding (pages_vec is keyed by pages.rowid and is
        // NOT cleaned by the FTS triggers; leaving it leaks, and because pages
        // is a rowid table SQLite reuses the id for the next inserted page,
        // silently mis-attributing the stale vector to a different page).
        const row = this.db
          .prepare('SELECT rowid, slug FROM pages WHERE path = ?')
          .get(relPath) as { rowid: number; slug: string } | undefined;

        if (row && hasVecTable(this.db)) {
          // sqlite-vec requires BigInt for rowid (mirrors index-file.ts).
          this.db
            .prepare('DELETE FROM pages_vec WHERE rowid = ?')
            .run(BigInt(row.rowid));
        }

        // Remove from pages (triggers also clean up FTS via triggers)
        this.db.prepare('DELETE FROM pages WHERE path = ?').run(relPath);
        // Links are keyed by from_path, so drop exactly this file's outbound
        // links — a same-slug sibling's links live under its own path and survive.
        this.db.prepare('DELETE FROM links WHERE from_path = ?').run(relPath);
        if (row) {
          // The slug→path resolver is still slug-keyed; recompute from whatever
          // pages remain (clears it when none are left, de-ambiguates survivors).
          recomputeWikilink(this.db, row.slug);
        }
      })
      .catch((err) => {
        console.error(`[watcher] delete failed for ${relPath}:`, err);
      });
    await this.indexChain;

    this.onEvent?.('unlink', filePath);
  }

  /** Stop the watcher. */
  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
