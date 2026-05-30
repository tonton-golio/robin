import fs from 'fs/promises';
import path from 'path';
import { pageHref } from '@/lib/catalog';
import { locateVault } from '@/lib/vault';
import type { MaintenanceItem } from './types';
import { numberValue, stringValue, type SqliteDb } from './shared';

export interface StalePagesSection {
  title: string;
  source: string;
  available: boolean;
  reason?: string;
  total: number;
  items: StalePage[];
}

export interface StalePage {
  path: string;
  slug: string;
  title: string | null;
  summary: string | null;
  tier: string | null;
  staleness: number;
  updated: string | null;
  lastAccessed: string | null;
  href: string;
}

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

export async function getStalePagesSection(limit: number): Promise<StalePagesSection> {
  const vault = locateVault();
  const dbPath = path.join(vault, '.robin', 'index.db');
  const source = path.join('.robin', 'index.db');

  try {
    await fs.access(dbPath);
  } catch {
    return {
      title: 'Stale pages',
      source,
      available: false,
      reason: 'index_db_missing',
      total: 0,
      items: [],
    };
  }

  let db: SqliteDb | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const indexer = require('@robin/indexer') as { openDb: (dbPath: string) => SqliteDb };
    db = indexer.openDb(dbPath);

    const cols = db.prepare('PRAGMA table_info(pages)').all() as { name?: unknown }[];
    const colNames = new Set(cols.map((col) => stringValue(col.name)).filter((name): name is string => Boolean(name)));
    if (!colNames.has('staleness')) {
      return {
        title: 'Stale pages',
        source,
        available: true,
        reason: 'staleness_column_missing',
        total: 0,
        items: [],
      };
    }

    const where = `
      staleness > 0.7
      AND (tier IS NULL OR tier != 'procedural')
      AND (state IS NULL OR state NOT IN ('archived', 'done', 'completed'))
      AND (last_accessed IS NULL OR last_accessed < datetime('now', '-60 days'))
    `;
    const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM pages WHERE ${where}`).get() as { count?: unknown } | undefined;
    const rows = db
      .prepare(
        `SELECT path, slug, title, summary, tier, staleness, updated, last_accessed
         FROM pages
         WHERE ${where}
         ORDER BY staleness DESC
         LIMIT ?`
      )
      .all(limit) as StaleRow[];

    return {
      title: 'Stale pages',
      source,
      available: true,
      total: numberValue(totalRow?.count) ?? rows.length,
      items: rows.map((row) => ({
        path: row.path,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        tier: row.tier,
        staleness: row.staleness,
        updated: row.updated,
        lastAccessed: row.last_accessed,
        href: pageHref(row.path),
      })),
    };
  } catch (error) {
    return {
      title: 'Stale pages',
      source,
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      total: 0,
      items: [],
    };
  } finally {
    try {
      db?.close();
    } catch {
      // Nothing useful to report here; the snapshot has already been built.
    }
  }
}

export function stalePageItem(item: StalePage): MaintenanceItem {
  return {
    id: `stale:${item.path}`,
    title: item.title ?? item.path,
    detail: item.summary ?? undefined,
    path: item.path,
    href: item.href,
    meta: [`staleness ${item.staleness.toFixed(2)}`, item.tier, item.updated].filter((value): value is string => Boolean(value)),
    severity: 'warning',
  };
}
