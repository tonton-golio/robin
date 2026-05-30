/**
 * vault.stats — Aggregate statistics about the vault.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v4';
import { parseRobinHtml } from '@robin/indexer';
import { findVaultHtmlFiles } from '../html-utils.js';
import type { ToolContext, VaultStatsOutput } from '../types.js';

export const VaultStatsInputSchema = z.object({}).describe('No input required');

export type VaultStatsInput = z.infer<typeof VaultStatsInputSchema>;

/**
 * Whether a wikilink target resolves to a page: by basename slug, or — for
 * path-like targets like 'features/images' — by exact or suffix match against
 * a page's vault-relative path (sans '.html').
 */
function targetResolves(target: string, slugSet: Set<string>, pathSet: Set<string>): boolean {
  if (target.includes('/')) {
    if (pathSet.has(target)) return true;
    for (const p of pathSet) {
      if (p.endsWith(`/${target}`)) return true;
    }
    return false;
  }
  return slugSet.has(target);
}

export async function vaultStats(
  _input: VaultStatsInput,
  ctx: ToolContext
): Promise<VaultStatsOutput> {
  // Try indexer first (fast)
  if (ctx.indexer) {
    try {
      return statsFromIndexer(ctx);
    } catch {
      // fall through to filesystem
    }
  }

  return statsFromFilesystem(ctx);
}

function statsFromIndexer(ctx: ToolContext): VaultStatsOutput {
  const db = ctx.indexer!.db;

  const totalRow = db.prepare('SELECT COUNT(*) as n FROM pages').get() as { n: number };
  const pages = totalRow.n;

  const typeRows = db.prepare('SELECT type, COUNT(*) as n FROM pages GROUP BY type').all() as Array<{
    type: string;
    n: number;
  }>;
  const by_type: Record<string, number> = {};
  for (const row of typeRows) {
    by_type[row.type ?? 'unknown'] = row.n;
  }

  const tierRows = db.prepare('SELECT tier, COUNT(*) as n FROM pages GROUP BY tier').all() as Array<{
    tier: string | null;
    n: number;
  }>;
  const by_tier: Record<string, number> = {};
  for (const row of tierRows) {
    by_tier[row.tier ?? 'untiered'] = row.n;
  }

  const linksRow = db.prepare('SELECT COUNT(*) as n FROM links').get() as { n: number };
  const links = linksRow.n;

  // Broken links: wikilink targets that resolve to no page (by slug or path).
  let broken_links = 0;
  try {
    const pageRows = db.prepare('SELECT path, slug FROM pages').all() as Array<{
      path: string;
      slug: string;
    }>;
    const slugSet = new Set(pageRows.map((r) => r.slug));
    const pathSet = new Set(pageRows.map((r) => r.path.replace(/\\/g, '/').replace(/\.html$/, '')));
    const linkRows = db.prepare('SELECT to_slug FROM links').all() as Array<{ to_slug: string }>;
    for (const { to_slug } of linkRows) {
      if (!targetResolves(to_slug, slugSet, pathSet)) broken_links++;
    }
  } catch {
    // ignore
  }

  // Ambiguous slugs
  let ambiguous_slugs = 0;
  try {
    const ambigRow = db.prepare('SELECT COUNT(*) as n FROM wikilinks WHERE ambiguous = 1').get() as { n: number };
    ambiguous_slugs = ambigRow.n;
  } catch {
    // ignore
  }

  return { pages, by_type, by_tier, links, broken_links, ambiguous_slugs };
}

function statsFromFilesystem(ctx: ToolContext): VaultStatsOutput {
  const htmlFiles = findVaultHtmlFiles(ctx.vaultPath);
  const by_type: Record<string, number> = {};
  const by_tier: Record<string, number> = {};
  let pages = 0;
  let links = 0;

  const slugSet = new Set<string>();
  const pathSet = new Set<string>();
  const allWikilinks: string[] = [];

  for (const absPath of htmlFiles) {
    try {
      const html = fs.readFileSync(absPath, 'utf8');
      const parsed = parseRobinHtml(html);
      const m = parsed.meta as Record<string, string | string[]>;
      const get = (key: string): string | undefined => {
        const v = m[`robin:${key}`];
        return Array.isArray(v) ? v[0] : v;
      };

      pages++;
      slugSet.add(path.basename(absPath, '.html'));
      pathSet.add(path.relative(ctx.vaultPath, absPath).replace(/\\/g, '/').replace(/\.html$/, ''));

      const type = get('type') ?? 'unknown';
      by_type[type] = (by_type[type] ?? 0) + 1;

      const tier = get('tier') ?? 'untiered';
      by_tier[tier] = (by_tier[tier] ?? 0) + 1;

      // Count DISTINCT (source, target) pairs per page so this matches the
      // indexer's `links` total, which is deduplicated by the PRIMARY KEY
      // (from_slug, to_slug, kind) — repeated wikilinks to the same target
      // from one page collapse to a single row there.
      links += new Set(parsed.wikilinkTargets).size;
      allWikilinks.push(...parsed.wikilinkTargets);
    } catch {
      // skip
    }
  }

  const broken_links = allWikilinks.filter((s) => !targetResolves(s, slugSet, pathSet)).length;

  return {
    pages,
    by_type,
    by_tier,
    links,
    broken_links,
    ambiguous_slugs: 0, // can't compute without indexer
  };
}
