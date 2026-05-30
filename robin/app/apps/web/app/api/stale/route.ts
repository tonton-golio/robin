import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { locateVault } from '@/lib/vault';

interface StaleRow {
  path: string;
  slug: string;
  title: string | null;
  summary: string | null;
  tier: string | null;
  staleness: number;
  updated: string | null;
  last_accessed: string | null;
}

/**
 * GET /api/stale?limit=50
 *
 * Returns the top-N stale pages from the index.
 * Pages qualify if:
 *   - staleness > 0.7
 *   - tier is not 'procedural'
 *   - state is not archived/done/completed
 *   - not accessed in the last 60 days (or never)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  // Defensive parse mirroring the sibling search/memory routes: a malformed
  // `?limit=abc` makes parseInt → NaN, and binding NaN to `LIMIT ?` makes
  // better-sqlite3 throw 'datatype mismatch', which the catch then swallows into
  // an empty list (the stale view silently shows ZERO pages). Fall back to 50.
  const rawLimit = Number(searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;

  let db: import('better-sqlite3').Database | undefined;
  try {
    // Dynamically load indexer to avoid breaking if not available
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { openDb } = require('@robin/indexer') as { openDb: (p: string) => import('better-sqlite3').Database };
    const vault = locateVault();
    const dbPath = path.join(vault, '.robin', 'index.db');
    db = openDb(dbPath);

    // Ensure staleness column exists (may not on older DBs)
    const cols = db.prepare('PRAGMA table_info(pages)').all() as { name: string }[];
    const hasStale = cols.some((c) => c.name === 'staleness');

    if (!hasStale) {
      return NextResponse.json([]);
    }

    const rows = db
      .prepare(
        `SELECT path, slug, title, summary, tier, staleness, updated, last_accessed
         FROM pages
         WHERE staleness > 0.7
           AND (tier IS NULL OR tier != 'procedural')
           AND (state IS NULL OR state NOT IN ('archived', 'done', 'completed'))
           AND (last_accessed IS NULL OR last_accessed < datetime('now', '-60 days'))
         ORDER BY staleness DESC
         LIMIT ?`
      )
      .all(limit) as StaleRow[];

    return NextResponse.json(rows);
  } catch (err) {
    // Indexer not available or DB doesn't exist yet
    console.warn('[stale] indexer unavailable:', String(err));
    return NextResponse.json([]);
  } finally {
    // Always close — a query-time throw must not leak the better-sqlite3 handle.
    db?.close();
  }
}
