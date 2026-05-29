/**
 * Indexer types for the Robin brain.
 *
 * These types describe the shape of data stored in SQLite and returned by search.
 * They are deliberately decoupled from the converter's RobinMeta so the indexer
 * can evolve its storage schema without coupling to the converter's type surface.
 */

/** Tier mapping by robin:type */
export type Tier = 'working' | 'episodic' | 'semantic' | 'procedural';

/** The canonical shape of a page record in the `pages` table */
export interface IndexedPage {
  path: string;            // vault-relative path, e.g. brain/foo.html
  slug: string;            // kebab-case, globally unique
  type: string;            // robin:type value
  title: string | null;
  summary: string | null;
  frontmatter: string | null;   // raw JSON string
  body_text: string | null;     // stripped text for FTS
  body_hash: string | null;     // sha256 of body_text; skip re-embed if unchanged
  tier: Tier | null;
  updated: string | null;       // ISO-8601 UTC
  state: string | null;
  importance: number;
  access_count_30d: number;
  last_accessed: string | null;
  indexed_at: string;
  staleness: number;
  access_count_30d_rolling: number;
}

/** A single search result hit */
export interface SearchHit {
  path: string;
  slug: string;
  title: string | null;
  summary: string | null;
  score: number;
  snippet?: string;
}

/** Options passed to createIndexer() */
export interface IndexerOptions {
  /** Absolute path to the vault root */
  vaultPath: string;
  /** Absolute path to the SQLite database file. Defaults to <vault>/.robin/index.db */
  dbPath?: string;
  /** If true, log progress to stdout */
  verbose?: boolean;
}

/** Options for search() */
export interface SearchOptions {
  /** Number of results to return (default 20) */
  k?: number;
  /** Filter by robin:type values */
  types?: string[];
  /** Filter by tier values */
  tiers?: string[];
  /** Filter by updated >= since (ISO-8601) */
  since?: string;
}

/** A raw link record */
export interface LinkRecord {
  from_slug: string;
  to_slug: string;
  kind: string;
}
