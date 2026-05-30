/**
 * Full-vault scan: index all canonical .html files under brain/ and out/.
 *
 * Processes files in parallel batches for throughput, but respects a
 * concurrency limit to avoid OOM when embedding is enabled.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { indexFile, recomputeWikilink } from './index-file.js';

/** Glob .html files under a directory recursively */
function findHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

export interface ScanResult {
  indexed: number;
  errors: number;
  wikilinks: number;
  ambiguous: number;
  /** Rows removed for files that no longer exist on disk (moved/deleted). */
  pruned: number;
}

/**
 * Scan the entire vault and index all Robin HTML files.
 *
 * @param db        Open SQLite connection
 * @param vaultPath Absolute path to vault root
 * @param verbose   If true, log per-file progress
 * @param concurrency Max simultaneous indexFile() calls (default 8)
 */
export async function scan(
  db: Database.Database,
  vaultPath: string,
  verbose = false,
  concurrency = 8
): Promise<ScanResult> {
  const allFiles: string[] = [
    ...findHtmlFiles(path.join(vaultPath, 'brain')),
    ...findHtmlFiles(path.join(vaultPath, 'out')),
  ];

  if (verbose) {
    console.log(`[scan] found ${allFiles.length} HTML files`);
  }

  let indexed = 0;
  let errors = 0;

  // Process in batches of `concurrency`
  for (let i = 0; i < allFiles.length; i += concurrency) {
    const batch = allFiles.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (filePath) => {
        try {
          await indexFile(db, filePath, vaultPath);
          indexed++;
          if (verbose) {
            const rel = path.relative(vaultPath, filePath);
            console.log(`  [ok] ${rel}`);
          }
        } catch (err) {
          errors++;
          console.error(`  [err] ${filePath}: ${String(err)}`);
        }
      })
    );
  }

  // Prune phantom rows: scan() owns brain/ and out/, so any pages row under
  // those roots not seen in this scan is for a file that was moved or deleted.
  // indexFile() only upserts; without this prune the stale row lingers forever,
  // inflating ambiguous-slug counts and mis-resolving wikilinks (e.g. a
  // [[slug]] whose old archived path still shadows the live one).
  const pruned = pruneMissing(db, vaultPath, allFiles);

  // Count wikilinks and ambiguous slugs (after prune, so counts are accurate)
  const { wikilinks, ambiguous } = getWikilinkStats(db);

  return { indexed, errors, wikilinks, ambiguous, pruned };
}

/**
 * Delete DB rows for files that no longer exist on disk under the scan's owned
 * roots (brain/, out/). Mirrors the watcher's unlink cleanup: drop the page row
 * (FTS cascades via triggers) and its vector, then for any slug left with no
 * surviving page drop its outbound links, and recompute the resolver row so the
 * slug de-ambiguates (or clears) based on whatever pages remain.
 */
function pruneMissing(
  db: Database.Database,
  vaultPath: string,
  allFiles: string[]
): number {
  const seen = new Set(
    allFiles.map((f) => path.relative(vaultPath, f).replace(/\\/g, '/'))
  );
  const owned = db
    .prepare("SELECT rowid, path, slug FROM pages WHERE path LIKE 'brain/%' OR path LIKE 'out/%'")
    .all() as Array<{ rowid: number; path: string; slug: string }>;

  const affectedSlugs = new Set<string>();
  const affectedPaths = new Set<string>();
  let pruned = 0;
  for (const row of owned) {
    if (seen.has(row.path)) continue;
    // Drop the vector first (keyed by rowid; no trigger cleans it).
    try {
      db.prepare('DELETE FROM pages_vec WHERE rowid = ?').run(BigInt(row.rowid));
    } catch {
      // no vec table / no row — non-fatal
    }
    db.prepare('DELETE FROM pages WHERE rowid = ?').run(row.rowid);
    affectedSlugs.add(row.slug);
    affectedPaths.add(row.path);
    pruned++;
  }

  // Links are keyed by from_path, so drop exactly the pruned page's outbound
  // links (no shared-slug guard needed — a sibling's links live under its own path).
  for (const p of affectedPaths) {
    db.prepare('DELETE FROM links WHERE from_path = ?').run(p);
  }
  // The slug→path resolver is still slug-keyed; recompute it from surviving pages.
  for (const slug of affectedSlugs) {
    recomputeWikilink(db, slug);
  }

  return pruned;
}

function getWikilinkStats(db: Database.Database): {
  wikilinks: number;
  ambiguous: number;
} {
  const wikilinksRow = db
    .prepare('SELECT COUNT(*) as count FROM links')
    .get() as { count: number };
  const ambiguousRow = db
    .prepare('SELECT COUNT(*) as count FROM wikilinks WHERE ambiguous = 1')
    .get() as { count: number };

  return {
    wikilinks: wikilinksRow.count,
    ambiguous: ambiguousRow.count,
  };
}
