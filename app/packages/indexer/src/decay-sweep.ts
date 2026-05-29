/**
 * Decay sweep — iterates all pages in the DB, recomputes staleness and
 * applies the rolling access-count decay, then persists both columns.
 *
 * Called nightly (or on-demand via CLI `sweep`).
 */

import type Database from 'better-sqlite3';
import { assignTier, computeStaleness } from './decay.js';

interface PageSweepRow {
  path: string;
  type: string;
  tier: string | null;
  updated: string | null;
  last_accessed: string | null;
  access_count_30d_rolling: number;
  staleness: number;
}

/** Daily decay factor for the rolling access counter: e^(-1/30) ≈ 0.967 */
const DAILY_DECAY = Math.exp(-1 / 30);

/**
 * Run a full decay sweep over all pages.
 *
 * For each page:
 *   1. Recompute staleness from tier + timestamps
 *   2. Apply daily decay to the rolling access counter
 *   3. Persist both back to the DB
 *
 * @returns Number of pages updated
 */
export function runDecaySweep(db: Database.Database, nowMs?: number): number {
  ensureDecayColumns(db);

  const rows = db
    .prepare(
      `SELECT path, type, tier, updated, last_accessed,
              access_count_30d_rolling, staleness
       FROM pages`
    )
    .all() as PageSweepRow[];

  const update = db.prepare(`
    UPDATE pages
    SET staleness = @staleness,
        access_count_30d_rolling = @access_count_30d_rolling
    WHERE path = @path
  `);

  const sweep = db.transaction(() => {
    for (const row of rows) {
      const tier = assignTier(row.type, row.tier);
      const staleness = computeStaleness(tier, row.last_accessed, row.updated, nowMs);
      // Apply daily decay — no access today means no +1
      const rolling = (row.access_count_30d_rolling ?? 0) * DAILY_DECAY;

      update.run({
        path: row.path,
        staleness,
        access_count_30d_rolling: rolling,
      });
    }
  });

  sweep();
  return rows.length;
}

/**
 * Ensure the decay columns exist (idempotent migration).
 * These may not exist on older DB files that predate Phase 9.
 */
export function ensureDecayColumns(db: Database.Database): void {
  const cols = db
    .prepare(`PRAGMA table_info(pages)`)
    .all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));

  if (!names.has('staleness')) {
    db.exec(`ALTER TABLE pages ADD COLUMN staleness REAL DEFAULT 0`);
  }
  if (!names.has('access_count_30d_rolling')) {
    db.exec(`ALTER TABLE pages ADD COLUMN access_count_30d_rolling REAL DEFAULT 0`);
  }
}
