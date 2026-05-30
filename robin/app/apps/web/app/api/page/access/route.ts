import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { locateVault } from '@/lib/vault';

/**
 * POST /api/page/access?path=brain/foo.html
 *
 * Increments the rolling access counter and updates last_accessed for a page.
 * Called by the client (via navigator.sendBeacon) when a page is opened.
 *
 * access_count_30d_rolling is incremented by 1 (the nightly sweep applies
 * the rolling decay, so we just add 1 here).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const pagePath = searchParams.get('path');

  if (!pagePath) {
    return NextResponse.json({ error: 'missing path param' }, { status: 400 });
  }

  let db: import('better-sqlite3').Database | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { openDb } = require('@robin/indexer') as { openDb: (p: string) => import('better-sqlite3').Database };
    const vault = locateVault();
    const dbPath = path.join(vault, '.robin', 'index.db');
    db = openDb(dbPath);

    // Ensure columns exist
    const cols = db.prepare('PRAGMA table_info(pages)').all() as { name: string }[];
    const hasRolling = cols.some((c) => c.name === 'access_count_30d_rolling');

    if (!hasRolling) {
      db.exec('ALTER TABLE pages ADD COLUMN access_count_30d_rolling REAL DEFAULT 0');
    }

    const now = new Date().toISOString();

    db.prepare(`
      UPDATE pages
      SET last_accessed = @now,
          access_count_30d = access_count_30d + 1,
          access_count_30d_rolling = COALESCE(access_count_30d_rolling, 0) + 1
      WHERE path = @path
    `).run({ now, path: pagePath });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Non-fatal — client fires this via beacon
    console.warn('[access] indexer unavailable:', String(err));
    return NextResponse.json({ ok: false });
  } finally {
    // Always close the handle — a throw on PRAGMA/ALTER/UPDATE (e.g. SQLITE_BUSY
    // under MCP-watcher write-lock contention) would otherwise leak the fd + WAL
    // handle on every beacon fired during contention.
    db?.close();
  }
}
