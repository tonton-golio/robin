import path from 'path';
import { numberValue, stringValue, type SqliteDb } from './shared';

export interface CompositionSection {
  title: string;
  source: string;
  available: boolean;
  reason?: string;
  pages: number;
  links: number;
  byType: Array<{ label: string; count: number }>;
  byTier: Array<{ label: string; count: number }>;
}

// Read-only vault composition over index.db, mirroring the mcp-server
// statsFromIndexer() query logic (copied here so we don't import mcp-server).
// The db handle is opened once by the snapshot orchestrator (read-only) and
// passed in; null means the index db is missing or could not be opened.
export async function getCompositionSection(db: SqliteDb | null): Promise<CompositionSection> {
  const source = path.join('.robin', 'index.db');

  const base: CompositionSection = {
    title: 'Vault composition',
    source,
    available: false,
    pages: 0,
    links: 0,
    byType: [],
    byTier: [],
  };

  if (!db) {
    return { ...base, reason: 'index_db_unavailable' };
  }

  try {
    const totalRow = db.prepare('SELECT COUNT(*) AS n FROM pages').get() as { n?: unknown } | undefined;
    const pages = numberValue(totalRow?.n) ?? 0;

    const typeRows = db.prepare('SELECT type, COUNT(*) AS n FROM pages GROUP BY type').all() as Array<{
      type?: unknown;
      n?: unknown;
    }>;
    const byType = typeRows
      .map((row) => ({ label: stringValue(row.type) ?? 'unknown', count: numberValue(row.n) ?? 0 }))
      .sort((a, b) => b.count - a.count);

    const tierRows = db.prepare('SELECT tier, COUNT(*) AS n FROM pages GROUP BY tier').all() as Array<{
      tier?: unknown;
      n?: unknown;
    }>;
    const byTier = tierRows
      .map((row) => ({ label: stringValue(row.tier) ?? 'untiered', count: numberValue(row.n) ?? 0 }))
      .sort((a, b) => b.count - a.count);

    let links = 0;
    try {
      const linksRow = db.prepare('SELECT COUNT(*) AS n FROM links').get() as { n?: unknown } | undefined;
      links = numberValue(linksRow?.n) ?? 0;
    } catch {
      // links table may be absent on old dbs.
    }

    return { ...base, available: true, pages, links, byType, byTier };
  } catch (error) {
    return { ...base, reason: error instanceof Error ? error.message : String(error) };
  }
}

export interface AmbiguousSlugs {
  // null when the index db is unavailable; a number (possibly 0) otherwise.
  count: number | null;
  // Up to 20 ambiguous slug names, surfaced as integrity items.
  slugs: string[];
}

// Ambiguous slugs — queried like statsFromIndexer() in mcp-server's
// vault-stats.ts (wikilinks.ambiguous = 1). Folded into format/link integrity.
// Returns the count AND the offending slug names (LIMIT 20) so the dashboard can
// list them rather than just tallying them.
export async function getAmbiguousSlugs(db: SqliteDb | null): Promise<AmbiguousSlugs> {
  if (!db) return { count: null, slugs: [] };
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM wikilinks WHERE ambiguous = 1').get() as
      | { n?: unknown }
      | undefined;
    const count = numberValue(row?.n) ?? 0;
    const slugRows = db
      .prepare('SELECT slug FROM wikilinks WHERE ambiguous = 1 ORDER BY slug LIMIT 20')
      .all() as { slug?: unknown }[];
    const slugs = slugRows
      .map((r) => stringValue(r.slug))
      .filter((s): s is string => Boolean(s));
    return { count, slugs };
  } catch {
    return { count: null, slugs: [] };
  }
}
