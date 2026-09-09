import fs from 'fs/promises';
import path from 'path';
import { locateVault } from '@/lib/vault';
import { numberValue, stringValue, walk, type SqliteDb } from './shared';

export interface IndexHealthSection {
  title: string;
  source: string;
  dbPresent: boolean;
  stalenessColumn: boolean;
  dbMtime: string | null;
  newestBrainMtime: string | null;
  newestBrainFile: string | null;
  // True when the newest brain file is newer than the index's own recorded
  // reindex time (MAX(indexed_at)) — brain content has changed since the last
  // reindex, so search/decay results may be behind. Derived from the DB's
  // recorded state rather than the db FILE mtime (which lags under WAL — the
  // main .db file's mtime does not advance while writes land in the -wal file).
  indexStale: boolean;
  lagMinutes: number | null;
  indexedPages: number | null;
  lastReindex: string | null;
  decayLastSwept: string | null;
  // Set when the db file exists but probing it failed (open error or a query
  // threw) — distinct from a legitimately-absent staleness column. When set,
  // the section is a WARN with the actual error, NOT a "column missing" report.
  probeError?: string;
  reason?: string;
}

// Slack applied before calling the index stale: a reindex commits indexed_at
// timestamps slightly after the brain files it read, and clock granularity /
// write ordering can leave a few seconds of apparent negative lag. 60s absorbs
// that without masking a real reindex backlog.
const INDEX_STALE_SLACK_MS = 60_000;

// The db handle is opened once by the snapshot orchestrator (read-only) and
// passed in; null means the index db could not be opened read-only.
export async function getIndexHealthSection(db: SqliteDb | null): Promise<IndexHealthSection> {
  const vault = locateVault();
  const dbPath = path.join(vault, '.robin', 'index.db');
  const source = path.join('.robin', 'index.db');

  const base: IndexHealthSection = {
    title: 'Index & engine health',
    source,
    dbPresent: false,
    stalenessColumn: false,
    dbMtime: null,
    newestBrainMtime: null,
    newestBrainFile: null,
    indexStale: false,
    lagMinutes: null,
    indexedPages: null,
    lastReindex: null,
    decayLastSwept: null,
  };

  // Newest brain file mtime — the freshness bar the index has to keep up with.
  const { mtimeMs: newestBrainMs, file: newestBrainFile } = await newestBrainMtime(vault);
  base.newestBrainMtime = newestBrainMs > 0 ? new Date(newestBrainMs).toISOString() : null;
  base.newestBrainFile = newestBrainFile;

  // db FILE mtime is a DISPLAYED metric only (see indexStale note above); it is
  // no longer the staleness signal.
  try {
    const dbStat = await fs.stat(dbPath);
    base.dbPresent = true;
    base.dbMtime = dbStat.mtime.toISOString();
  } catch {
    return { ...base, reason: 'index_db_missing' };
  }

  if (!db) {
    // File is present but the orchestrator could not open it read-only.
    return { ...base, probeError: 'index db present but could not be opened read-only' };
  }

  // Defensive PRAGMA probe (mirrors stale-pages.ts): the db may exist without
  // the decay columns if it predates the staleness migration.
  try {
    const cols = db.prepare('PRAGMA table_info(pages)').all() as { name?: unknown }[];
    const colNames = new Set(cols.map((col) => stringValue(col.name)).filter((n): n is string => Boolean(n)));
    base.stalenessColumn = colNames.has('staleness');

    // Cheap last-reindex stats — no reindex is triggered here.
    try {
      const row = db.prepare('SELECT COUNT(*) AS n, MAX(indexed_at) AS last FROM pages').get() as
        | { n?: unknown; last?: unknown }
        | undefined;
      base.indexedPages = numberValue(row?.n) ?? null;
      base.lastReindex = stringValue(row?.last) ?? null;
    } catch {
      // indexed_at column may be absent on very old dbs; leave nulls.
    }

    // Staleness signal (F3): compare the newest brain file to the index's own
    // recorded reindex time (MAX(indexed_at)), NOT the db file mtime.
    const reindexMs = base.lastReindex ? Date.parse(base.lastReindex) : NaN;
    if (newestBrainMs > 0 && Number.isFinite(reindexMs)) {
      const lagMs = newestBrainMs - reindexMs;
      base.indexStale = lagMs > INDEX_STALE_SLACK_MS;
      base.lagMinutes = base.indexStale ? Math.round(lagMs / 60_000) : 0;
    }

    try {
      const decayRow = db.prepare("SELECT value FROM meta WHERE key = 'decay_last_swept'").get() as
        | { value?: unknown }
        | undefined;
      base.decayLastSwept = stringValue(decayRow?.value) ?? null;
    } catch {
      // meta table may not exist; leave null.
    }

    return base;
  } catch (error) {
    // Probe failed AFTER the db file was confirmed present. Carry a distinct
    // probeError so the snapshot reports the real error (WARN) instead of
    // collapsing to a misleading "staleness column missing" (CRITICAL).
    return { ...base, probeError: error instanceof Error ? error.message : String(error) };
  }
}

async function newestBrainMtime(vault: string): Promise<{ mtimeMs: number; file: string | null }> {
  const relFiles = (await walk(vault, 'brain')).filter((file) => file.endsWith('.html'));
  const stats = await Promise.all(
    relFiles.map(async (relFile) => {
      try {
        const s = await fs.stat(path.join(vault, relFile));
        return { relFile, mtimeMs: s.mtimeMs };
      } catch {
        return { relFile, mtimeMs: 0 };
      }
    })
  );
  let best = { mtimeMs: 0, file: null as string | null };
  for (const s of stats) {
    if (s.mtimeMs > best.mtimeMs) best = { mtimeMs: s.mtimeMs, file: s.relFile };
  }
  return best;
}
