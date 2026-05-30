/**
 * Index a single Robin HTML file into SQLite.
 *
 * Flow:
 *   1. Read file from disk
 *   2. parseRobinHtml → extract meta, frontmatter, blocks, bodyText, wikilinks
 *   3. Compute sha256 of bodyText
 *   4. Upsert into pages table
 *   5. If bodyHash changed (or new), recompute embedding → upsert into pages_vec
 *   6. Delete + reinsert links for this slug
 *   7. Update wikilinks resolver table
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { parseRobinHtml } from './parse-html.js';
import { embed, serializeEmbedding } from './embeddings.js';
import type { Tier } from './types.js';

/** Derive tier from robin:type */
function typeToTier(type: string): Tier {
  switch (type) {
    case 'task':
      return 'working';
    case 'meeting':
    case 'interview':
    case 'brief':
    case 'remsleep':
    case 'work-log':
      return 'episodic';
    case 'person':
    case 'candidate':
    case 'project':
    case 'feature':
    case 'knowledge':
    case 'understanding':
    case 'reference':
    case 'tool':
    case 'repo':
    case 'decision':
    case 'note':
    case 'index':
    case 'report':
    case 'reflection':
      return 'semantic';
    case 'template':
    case 'skill':
    case 'playbook':
      return 'procedural';
    default:
      return 'semantic';
  }
}

/** Get the first value from a meta entry (which may be a string or string[]) */
function firstMeta(val: string | string[] | undefined): string | null {
  if (val === undefined) return null;
  if (Array.isArray(val)) return val[0] ?? null;
  return val;
}

/** Check whether the pages_vec table exists */
function hasVecTable(db: Database.Database): boolean {
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='pages_vec'`
    )
    .get() as { name: string } | undefined;
  return !!row;
}

/**
 * Index one HTML file into the database.
 *
 * @param db       Open SQLite connection
 * @param filePath Absolute path to the .html file
 * @param vaultPath Absolute path to vault root (used to compute vault-relative path)
 */
export async function indexFile(
  db: Database.Database,
  filePath: string,
  vaultPath: string
): Promise<void> {
  const html = fs.readFileSync(filePath, 'utf-8');

  const parsed = parseRobinHtml(html);
  const { meta, frontmatter, bodyText, wikilinkTargets } = parsed;

  // Derive core fields from meta
  const slug = firstMeta(meta['robin:slug']) ?? path.basename(filePath, '.html');
  const type = firstMeta(meta['robin:type']) ?? 'note';
  const title = document_title_from_html(html) ?? slug;
  const summary = firstMeta(meta['robin:summary']);
  const updated = firstMeta(meta['robin:updated']);
  // `robin:status` and `robin:state` are synonyms; tasks predominantly stamp
  // `status`, so fall back to it or status-keyed pages index with a null state.
  const state = firstMeta(meta['robin:state']) ?? firstMeta(meta['robin:status']);
  // Respect explicit robin:tier override, else derive from type
  const explicitTier = firstMeta(meta['robin:tier']) as Tier | null;
  const tier: Tier = explicitTier ?? typeToTier(type);

  // Vault-relative path
  const relPath = path.relative(vaultPath, filePath);

  // Hash body text
  const bodyHash = bodyText
    ? crypto.createHash('sha256').update(bodyText).digest('hex')
    : null;

  // Serialize frontmatter for storage
  const frontmatterJson =
    frontmatter !== null ? JSON.stringify(frontmatter) : null;

  const now = new Date().toISOString();

  // Check if we already have this page and whether hash changed
  const existing = db
    .prepare('SELECT body_hash, rowid FROM pages WHERE path = ?')
    .get(relPath) as { body_hash: string | null; rowid: number } | undefined;

  const hashChanged = !existing || existing.body_hash !== bodyHash;

  // Upsert page record
  db.prepare(`
    INSERT INTO pages
      (path, slug, type, title, summary, frontmatter, body_text, body_hash,
       tier, updated, state, importance, access_count_30d, last_accessed, indexed_at,
       staleness, access_count_30d_rolling)
    VALUES
      (@path, @slug, @type, @title, @summary, @frontmatter, @body_text, @body_hash,
       @tier, @updated, @state, 0, 0, NULL, @indexed_at, 0, 0)
    ON CONFLICT(path) DO UPDATE SET
      slug          = excluded.slug,
      type          = excluded.type,
      title         = excluded.title,
      summary       = excluded.summary,
      frontmatter   = excluded.frontmatter,
      body_text     = excluded.body_text,
      body_hash     = excluded.body_hash,
      tier          = excluded.tier,
      updated       = excluded.updated,
      state         = excluded.state,
      indexed_at    = excluded.indexed_at
      -- staleness + access_count_30d_rolling intentionally NOT overwritten on re-index
  `).run({
    path: relPath,
    slug,
    type,
    title,
    summary,
    frontmatter: frontmatterJson,
    body_text: bodyText || null,
    body_hash: bodyHash,
    tier,
    updated,
    state,
    indexed_at: now,
  });

  // Recompute the wikilinks resolver entry for this slug from the pages table.
  // The old approach incrementally set a sticky `ambiguous` flag that never
  // cleared once tripped (and a no-op path CASE), so a slug stayed ambiguous
  // forever even after the colliding page was deleted/renamed. Recomputing from
  // `pages` self-corrects on every index.
  recomputeWikilink(db, slug);

  // Recompute embedding if body changed
  if (hashChanged && bodyText && hasVecTable(db)) {
    try {
      const pageRow = db
        .prepare('SELECT rowid FROM pages WHERE path = ?')
        .get(relPath) as { rowid: number } | undefined;

      if (pageRow) {
        const vec = await embed(bodyText.slice(0, 8192)); // truncate for embedding
        const vecBuf = serializeEmbedding(vec);

        // sqlite-vec requires BigInt for rowid (unlike standard SQLite)
        const rowid = BigInt(pageRow.rowid);

        // Delete old vector if exists
        db.prepare('DELETE FROM pages_vec WHERE rowid = ?').run(rowid);
        // Insert new vector
        db.prepare('INSERT INTO pages_vec (rowid, embedding) VALUES (?, ?)').run(
          rowid,
          vecBuf
        );
      }
    } catch (err) {
      // Embedding failure is non-fatal
      console.warn(`[indexer] embedding failed for ${relPath}: ${String(err)}`);
    }
  }

  // Update links: delete old outbound links from this slug, reinsert
  db.prepare('DELETE FROM links WHERE from_slug = ?').run(slug);
  const insertLink = db.prepare(`
    INSERT OR IGNORE INTO links (from_slug, to_slug, kind) VALUES (?, ?, 'wikilink')
  `);
  for (const target of wikilinkTargets) {
    insertLink.run(slug, target);
  }
}

/**
 * Recompute the wikilinks resolver row for a slug from the current `pages` rows.
 * Picks the lexicographically-smallest path as the canonical target and marks
 * the slug ambiguous only when more than one page currently shares it. Safe to
 * call after either an upsert or a delete of a page with this slug — if no page
 * remains, the resolver row is removed.
 */
export function recomputeWikilink(db: Database.Database, slug: string): void {
  db.prepare('DELETE FROM wikilinks WHERE slug = ?').run(slug);
  db.prepare(`
    INSERT INTO wikilinks (slug, path, ambiguous)
    SELECT slug, MIN(path), CASE WHEN COUNT(*) > 1 THEN 1 ELSE 0 END
    FROM pages
    WHERE slug = ?
    GROUP BY slug
  `).run(slug);
}

/** Extract <title> text from raw HTML without a full parse */
function document_title_from_html(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1]!.trim() || null : null;
}
