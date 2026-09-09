/**
 * File-system watcher for the Robin vault.
 *
 * Uses chokidar to watch canonical .html files under brain/ and out/.
 * Includes a self-write filter: when Robin itself writes a file, it calls
 * notifyWroteFile() to suppress the resulting change event for 500ms.
 * This prevents access-counter pollution from canonical saves.
 */

import chokidar from "chokidar";
import path from "path";
import type Database from "better-sqlite3";
import { indexFile, recomputeWikilink, hasVecTable } from "./index-file.js";
import { INDEXED_PAGE_ROOTS, isIndexedPagePath } from "./types.js";

export type WatchEvent = "add" | "change" | "unlink";
export type WatchCallback = (event: WatchEvent, filePath: string) => void;

/** Remove one vault-relative page and all path/slug/vector projections. */
export function removeIndexedPath(db: Database.Database, relPath: string): void {
  const row = db.prepare("SELECT rowid, slug FROM pages WHERE path = ?").get(relPath) as
    | { rowid: number; slug: string }
    | undefined;

  if (row && hasVecTable(db)) {
    db.prepare("DELETE FROM pages_vec WHERE rowid = ?").run(BigInt(row.rowid));
  }
  db.prepare("DELETE FROM pages WHERE path = ?").run(relPath);
  db.prepare("DELETE FROM links WHERE from_path = ?").run(relPath);
  if (row) recomputeWikilink(db, row.slug);
}

export class Watcher {
  private readonly vaultPath: string;
  private readonly db: Database.Database;
  private readonly onEvent?: WatchCallback;
  private readonly verbose: boolean;

  /** path → expiry timestamp (ms). If expiry > now, ignore the next event. */
  private readonly recentlyWrittenByUs = new Map<string, number>();

  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private readyPromise: Promise<void> = Promise.resolve();

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
    // Chokidar 5 no longer expands glob patterns. Watch the owned directories
    // directly and filter files below them so raw logs and unrelated files do
    // not enter the index.
    const roots = INDEXED_PAGE_ROOTS.map((root) => path.join(this.vaultPath, root));
    const isAllowedEventPath = (candidate: string): boolean => {
      const relPath = path.relative(this.vaultPath, candidate);
      return isIndexedPagePath(relPath);
    };

    this.watcher = chokidar.watch(roots, {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (
        candidate: string,
        stats?: { isDirectory(): boolean; isSymbolicLink(): boolean },
      ) => {
        // Keep directory traversal enabled, including directories discovered
        // after startup. For files, only canonical HTML paths are watched.
        if (stats?.isSymbolicLink()) return true;
        if (stats?.isDirectory()) return false;
        if (!stats && path.extname(candidate) === "") return false;
        return !isAllowedEventPath(candidate);
      },
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50,
      },
    });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.watcher?.once("ready", resolve);
      this.watcher?.once("error", reject);
    });

    this.watcher.on("add", (filePath: string) => this.handleEvent("add", filePath));
    this.watcher.on("change", (filePath: string) => this.handleEvent("change", filePath));
    this.watcher.on("unlink", (filePath: string) => this.handleUnlink(filePath));
    this.watcher.on("error", (err: unknown) => {
      console.error("[watcher] error:", err);
    });

    if (this.verbose) {
      console.log(`[watcher] watching ${roots.join(", ")}`);
    }

    return this;
  }

  /** Wait until chokidar has completed its initial directory crawl. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  private async handleEvent(event: WatchEvent, filePath: string): Promise<void> {
    if (!isIndexedPagePath(path.relative(this.vaultPath, filePath))) return;
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
    if (!isIndexedPagePath(path.relative(this.vaultPath, filePath))) return;
    if (this.shouldIgnore(filePath)) return;
    if (this.verbose) console.log(`[watcher] unlink: ${filePath}`);

    const relPath = path.relative(this.vaultPath, filePath);
    // Serialize the unlink cleanup on the same chain as indexing so it cannot
    // interleave with an in-flight indexFile (which awaits embed mid-sequence).
    this.indexChain = this.indexChain
      .then(() => {
        removeIndexedPath(this.db, relPath);
      })
      .catch((err) => {
        console.error(`[watcher] delete failed for ${relPath}:`, err);
      });
    await this.indexChain;

    this.onEvent?.("unlink", filePath);
  }

  /** Stop the watcher. */
  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
