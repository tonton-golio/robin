/**
 * Full-vault scan: index all canonical .html files under brain/ and out/.
 *
 * Processes files in parallel batches for throughput, but respects a
 * concurrency limit to avoid OOM when embedding is enabled.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { indexFile } from './index-file.js';

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

  // Count wikilinks and ambiguous slugs
  const { wikilinks, ambiguous } = getWikilinkStats(db);

  return { indexed, errors, wikilinks, ambiguous };
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
