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

const DAY_MS = 1000 * 60 * 60 * 24;

/** Meta key storing the last calendar day (YYYY-MM-DD) the rolling decay ran. */
const DECAY_LAST_SWEPT_KEY = 'decay_last_swept';

/** Local-midnight epoch ms for a given instant — decay counts calendar days. */
function localMidnightMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local YYYY-MM-DD for a given instant. */
function localDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Run a full decay sweep over all pages.
 *
 * For each page:
 *   1. Recompute staleness from tier + timestamps
 *   2. Apply daily decay to the rolling access counter
 *   3. Persist both back to the DB
 *
 * Day-idempotent: the access route adds +1 per open and relies on EXACTLY one
 * decay multiplication per calendar day. But there is no single sweep caller —
 * each createIndexer schedules its own 03:00 timer, the web process holds two
 * indexer instances on the same DB (indexer-client + xai-relay), and the CLI /
 * recomputeStaleness can call it again. So we persist the last-swept date and
 * exponentiate the decay by the number of elapsed calendar days: re-running on
 * the same day is a no-op for the rolling counter (factor = DAILY_DECAY**0 = 1),
 * while a sweep after an N-day gap applies DAILY_DECAY**N. Staleness recompute is
 * already idempotent (derived from timestamps) so it always runs.
 *
 * @returns Number of pages updated
 */
export function runDecaySweep(db: Database.Database, nowMs?: number): number {
  ensureDecayColumns(db);
  ensureMetaTable(db);

  const now = nowMs ?? Date.now();

  const rows = db
    .prepare(
      `SELECT path, type, tier, updated, last_accessed,
              access_count_30d_rolling, staleness
       FROM pages`
    )
    .all() as PageSweepRow[];

  const readMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
  const writeMeta = db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );

  const update = db.prepare(`
    UPDATE pages
    SET staleness = @staleness,
        access_count_30d_rolling = @access_count_30d_rolling
    WHERE path = @path
  `);

  const sweep = db.transaction(() => {
    // Number of calendar days since the last decay (0 ⇒ already swept today).
    const lastSwept = (readMeta.get(DECAY_LAST_SWEPT_KEY) as { value: string } | undefined)?.value;
    let days = 1; // first-ever sweep applies one day's decay
    if (lastSwept) {
      const lastMs = Date.parse(`${lastSwept}T00:00:00`);
      if (!Number.isNaN(lastMs)) {
        days = Math.max(0, Math.floor((localMidnightMs(now) - lastMs) / DAY_MS));
      }
    }
    const factor = days === 0 ? 1 : DAILY_DECAY ** days;

    for (const row of rows) {
      const tier = assignTier(row.type, row.tier);
      const staleness = computeStaleness(tier, row.last_accessed, row.updated, now);
      // Apply N-day decay — no access on a day means no +1
      const rolling = (row.access_count_30d_rolling ?? 0) * factor;

      update.run({
        path: row.path,
        staleness,
        access_count_30d_rolling: rolling,
      });
    }

    writeMeta.run(DECAY_LAST_SWEPT_KEY, localDateKey(now));
  });

  sweep();
  return rows.length;
}

/**
 * Ensure the key/value `meta` table exists (idempotent migration). Hosts the
 * decay last-swept date; created here so a DB that predates it self-upgrades.
 */
export function ensureMetaTable(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`
  );
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
