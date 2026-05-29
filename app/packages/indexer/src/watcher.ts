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
import { indexFile, recomputeWikilink } from './index-file.js';

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

    try {
      await indexFile(this.db, filePath, this.vaultPath);
    } catch (err) {
      console.error(`[watcher] index failed for ${filePath}:`, err);
    }

    this.onEvent?.(event, filePath);
  }

  private handleUnlink(filePath: string): void {
    if (this.shouldIgnore(filePath)) return;
    if (this.verbose) console.log(`[watcher] unlink: ${filePath}`);

    const relPath = path.relative(this.vaultPath, filePath);
    try {
      // Remove from pages (triggers also clean up FTS via triggers)
      const row = this.db
        .prepare('SELECT slug FROM pages WHERE path = ?')
        .get(relPath) as { slug: string } | undefined;

      this.db.prepare('DELETE FROM pages WHERE path = ?').run(relPath);
      if (row) {
        // Slugs are not unique (every dir has its own _index). Only drop links
        // and the resolver row when no other page still carries this slug —
        // otherwise we'd wipe a surviving sibling's links/resolution.
        const remaining = this.db
          .prepare('SELECT COUNT(*) AS n FROM pages WHERE slug = ?')
          .get(row.slug) as { n: number };
        if (remaining.n === 0) {
          this.db.prepare('DELETE FROM links WHERE from_slug = ?').run(row.slug);
        }
        // Recompute the resolver entry from whatever pages remain (clears it
        // when none are left, de-ambiguates when only one survives).
        recomputeWikilink(this.db, row.slug);
      }
    } catch (err) {
      console.error(`[watcher] delete failed for ${relPath}:`, err);
    }

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
