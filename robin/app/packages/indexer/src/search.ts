/**
 * RRF (Reciprocal Rank Fusion) search over FTS5 + sqlite-vec + 2-hop graph.
 *
 * Implemented app-side (not a single SQL query) for clarity and testability.
 * Steps:
 *   1. FTS5 BM25 — full-text search with bm25 ranking
 *   2. sqlite-vec cosine — vector similarity search
 *   3. 2-hop graph expansion — expand top FTS hits via the links table
 *   4. RRF fusion of the three ranked lists
 *   5. Apply JS-side type/tier/since filters
 *   6. Return top-k with snippets
 *
 * Decay scoring: recomputeStaleness() is provided as a placeholder.
 * It calculates a staleness score but does NOT alter SQL ranking in this phase.
 * Wire it in Phase 9.
 */

import type Database from 'better-sqlite3';
import { embed, serializeEmbedding } from './embeddings.js';
import type { SearchHit, SearchOptions } from './types.js';
import { assignTier, computeFinalScore } from './decay.js';
import { runDecaySweep } from './decay-sweep.js';

const DEFAULT_K = 20;
const FTS_LIMIT = 50;
const VEC_LIMIT = 50;
const RRF_K_CONSTANT = 60; // RRF constant; higher = smoother falloff

interface PageRow {
  rowid: number;
  path: string;
  slug: string;
  title: string | null;
  summary: string | null;
  body_text: string | null;
  type: string;
  tier: string | null;
  updated: string | null;
  last_accessed: string | null;
  access_count_30d_rolling: number | null;
}

interface FtsRow extends PageRow {
  bm25_score: number;
}

interface VecRow {
  rowid: number;
  distance: number;
}

/** Check if pages_vec table is available */
function hasVecTable(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pages_vec'`)
    .get() as { name: string } | undefined;
  return !!row;
}

/**
 * Get slugs linked FROM any of the seed slugs (outbound) and TO any seed slug (inbound).
 * Returns a deduplicated list of slugs in two hops.
 */
function expandTwoHop(db: Database.Database, seedSlugs: string[]): string[] {
  if (seedSlugs.length === 0) return [];

  const placeholders = seedSlugs.map(() => '?').join(',');

  // 1-hop: pages linked from seeds or linking to seeds
  const hop1Rows = db
    .prepare(
      `SELECT DISTINCT to_slug AS slug FROM links WHERE from_slug IN (${placeholders})
       UNION
       SELECT DISTINCT from_slug AS slug FROM links WHERE to_slug IN (${placeholders})`
    )
    .all([...seedSlugs, ...seedSlugs]) as { slug: string }[];

  const hop1Slugs = hop1Rows.map((r) => r.slug).filter((s) => !seedSlugs.includes(s));

  if (hop1Slugs.length === 0) return [];

  // 2-hop: pages linked from/to hop1
  const hop1Placeholders = hop1Slugs.map(() => '?').join(',');
  const hop2Rows = db
    .prepare(
      `SELECT DISTINCT to_slug AS slug FROM links WHERE from_slug IN (${hop1Placeholders})
       UNION
       SELECT DISTINCT from_slug AS slug FROM links WHERE to_slug IN (${hop1Placeholders})`
    )
    .all([...hop1Slugs, ...hop1Slugs]) as { slug: string }[];

  const allSlugs = new Set([...hop1Slugs, ...hop2Rows.map((r) => r.slug)]);
  // Exclude seeds
  for (const s of seedSlugs) allSlugs.delete(s);

  return [...allSlugs];
}

/**
 * RRF fusion of multiple ranked lists.
 *
 * Each list is an ordered array of identifiers. Returns a map from identifier
 * to fused RRF score (higher is better).
 */
function rrfFuse(rankedLists: string[][]): Map<string, number> {
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    list.forEach((id, idx) => {
      const rank = idx + 1;
      const contribution = 1 / (RRF_K_CONSTANT + rank);
      scores.set(id, (scores.get(id) ?? 0) + contribution);
    });
  }

  return scores;
}

/** Generate a short snippet from body text around a query term */
function makeSnippet(bodyText: string | null, query: string): string | undefined {
  if (!bodyText) return undefined;

  const lower = bodyText.toLowerCase();
  const qLower = query.toLowerCase().split(/\s+/)[0] ?? '';
  const idx = qLower ? lower.indexOf(qLower) : -1;

  if (idx === -1) {
    return bodyText.slice(0, 150).trim() + (bodyText.length > 150 ? '…' : '');
  }

  const start = Math.max(0, idx - 60);
  const end = Math.min(bodyText.length, idx + 120);
  let snippet = bodyText.slice(start, end).trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < bodyText.length) snippet += '…';
  return snippet;
}

/**
 * Main search function.
 *
 * @param db    Open SQLite connection
 * @param query Search query string
 * @param opts  Optional filters and k
 */
export async function search(
  db: Database.Database,
  query: string,
  opts: SearchOptions = {}
): Promise<SearchHit[]> {
  const k = opts.k ?? DEFAULT_K;

  // Sanitize FTS5 query: escape special chars that would cause parse errors
  const ftsQuery = sanitizeFtsQuery(query);

  // --- 1. FTS5 BM25 ---
  let bm25Rows: FtsRow[] = [];
  try {
    bm25Rows = db
      .prepare(
        `SELECT pages.rowid, pages.path, pages.slug, pages.title, pages.summary,
                pages.body_text, pages.type, pages.tier, pages.updated,
                pages.last_accessed,
                COALESCE(pages.access_count_30d_rolling, 0) AS access_count_30d_rolling,
                bm25(pages_fts) AS bm25_score
         FROM pages_fts
         JOIN pages ON pages.rowid = pages_fts.rowid
         WHERE pages_fts MATCH ?
         ORDER BY bm25_score
         LIMIT ?`
      )
      .all(ftsQuery, FTS_LIMIT) as FtsRow[];
  } catch {
    // FTS query may fail on empty or special-char-only queries
    bm25Rows = [];
  }

  // --- 2. sqlite-vec vector search ---
  const vecPaths: string[] = [];
  const rowIdToPath = new Map<number, string>();

  if (hasVecTable(db)) {
    try {
      const qVec = await embed(query);
      const qBuf = serializeEmbedding(qVec);

      const vecRows = db
        .prepare(
          `SELECT rowid, distance FROM pages_vec
           WHERE embedding MATCH ? AND k = ?`
        )
        .all(qBuf, VEC_LIMIT) as VecRow[];

      for (const row of vecRows) {
        // sqlite-vec returns rowid as BigInt; convert to Number for pages lookup
        const rowidNum = Number(row.rowid);
        const pageRow = db
          .prepare('SELECT path FROM pages WHERE rowid = ?')
          .get(rowidNum) as { path: string } | undefined;
        if (pageRow) {
          vecPaths.push(pageRow.path);
          rowIdToPath.set(rowidNum, pageRow.path);
        }
      }
    } catch {
      // Vec search unavailable or embedding failed — skip
    }
  }

  // --- 3. 2-hop graph expansion ---
  const seedSlugs = bm25Rows.slice(0, 10).map((r) => r.slug);
  const graphSlugs = expandTwoHop(db, seedSlugs);

  // Resolve graph slugs → paths
  const graphPaths: string[] = [];
  for (const slug of graphSlugs) {
    const row = db
      .prepare('SELECT path FROM pages WHERE slug = ?')
      .get(slug) as { path: string } | undefined;
    if (row) graphPaths.push(row.path);
  }

  // --- 4. RRF fusion ---
  const bm25Paths = bm25Rows.map((r) => r.path);
  const fusedScores = rrfFuse([bm25Paths, vecPaths, graphPaths]);

  // Sort by fused score descending
  const sortedPaths = [...fusedScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);

  // --- 5. Load full records and apply filters ---
  const results: SearchHit[] = [];

  for (const p of sortedPaths) {
    if (results.length >= k) break;

    const row = db
      .prepare('SELECT * FROM pages WHERE path = ?')
      .get(p) as PageRow | undefined;

    if (!row) continue;

    // Apply type filter
    if (opts.types && opts.types.length > 0 && !opts.types.includes(row.type)) {
      continue;
    }

    // Apply tier filter
    if (opts.tiers && opts.tiers.length > 0 && row.tier && !opts.tiers.includes(row.tier)) {
      continue;
    }

    // Apply since filter
    if (opts.since && row.updated && row.updated < opts.since) {
      continue;
    }

    const rrfScore = fusedScores.get(p) ?? 0;
    const tier = assignTier(row.type, row.tier);
    const access30d = row.access_count_30d_rolling ?? 0;
    const score = computeFinalScore(rrfScore, tier, access30d, row.last_accessed, row.updated);

    results.push({
      path: row.path,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      score,
      snippet: makeSnippet(row.body_text, query),
    });
  }

  return results;
}

/**
 * Sanitize a query string for safe use in FTS5 MATCH.
 * Wraps in double-quotes if it contains special FTS5 operators, else passes through.
 */
function sanitizeFtsQuery(query: string): string {
  // FTS5 special chars: " ( ) * : ^ - +
  // Simple approach: if only alphanumeric + spaces, use as-is with * prefix for prefix matching.
  // Otherwise, quote each token.
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '""';

  return tokens
    .map((t) => {
      // Remove characters that are problematic in FTS5
      const clean = t.replace(/["""()*:^+\-]/g, '').trim();
      if (!clean) return null;
      // Prefix match: append * for partial matching
      return `"${clean}"*`;
    })
    .filter(Boolean)
    // Implicit AND (space) rather than OR: every term must match, so a
    // multi-word query is precise instead of returning any page that contains
    // any single term. The vector arm of the RRF fusion supplies semantic
    // recall, so FTS can stay strict.
    .join(' ');
}

/**
 * Recompute staleness scores for all pages and persist them.
 *
 * Delegates to runDecaySweep (Phase 9 implementation).
 * Returns a map from path → staleness score for backward compat.
 */
export function recomputeStaleness(
  db: Database.Database,
  nowIso?: string
): Map<string, number> {
  const nowMs = nowIso ? new Date(nowIso).getTime() : undefined;
  runDecaySweep(db, nowMs);

  const rows = db
    .prepare('SELECT path, COALESCE(staleness, 0) as staleness FROM pages')
    .all() as { path: string; staleness: number }[];

  const scores = new Map<string, number>();
  for (const row of rows) {
    scores.set(row.path, row.staleness);
  }
  return scores;
}
