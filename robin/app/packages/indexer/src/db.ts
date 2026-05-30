/**
 * SQLite schema + migrations for the Robin indexer.
 *
 * Uses better-sqlite3 (sync API) + sqlite-vec (loaded as extension).
 * The vec extension is loaded once on connect; all subsequent calls are safe.
 */

import Database from 'better-sqlite3';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

// sqlite-vec ships a native addon; we load it via loadExtension.
// The package exposes a getLoadablePath() helper.
let sqliteVecPath: string | null = null;

function getSqliteVecPath(): string | null {
  if (sqliteVecPath !== null) return sqliteVecPath;
  try {
    const require = createRequire(import.meta.url);
    // sqlite-vec exports { getLoadablePath } for the current platform
    const sqliteVec = require('sqlite-vec');
    if (typeof sqliteVec.getLoadablePath === 'function') {
      sqliteVecPath = sqliteVec.getLoadablePath() as string;
    } else if (typeof sqliteVec.path === 'string') {
      sqliteVecPath = sqliteVec.path as string;
    } else {
      sqliteVecPath = null;
    }
  } catch {
    sqliteVecPath = null;
  }
  return sqliteVecPath;
}

// v2: pages.slug is no longer UNIQUE. Slugs are not globally unique in the
// vault (every directory has an `_index` page); the unique key is `path`.
// Resolution prefers path matching and falls back to a unique basename slug.
// v3: links table re-keyed from (from_slug,…) to (from_path,…) so non-unique
// slugs (every dir's `_index`) no longer collapse outbound links / fan out
// backlinks. Bumping the version drops + rebuilds the derived tables on a rescan.
const SCHEMA_VERSION = 3;

const DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

-- NOTE: pages_fts and pages_vec are keyed by pages.rowid. SQLite reassigns
-- rowids on VACUUM, which would silently de-align every FTS/vector row from its
-- page. Do NOT run VACUUM on this database — rebuild the derived tables via a
-- full resync instead. (No code path vacuums; this guards against adding one.)
CREATE TABLE IF NOT EXISTS pages (
  path            TEXT PRIMARY KEY,
  slug            TEXT NOT NULL,
  type            TEXT NOT NULL,
  title           TEXT,
  summary         TEXT,
  frontmatter     TEXT,
  body_text       TEXT,
  body_hash       TEXT,
  tier            TEXT,
  updated         TEXT,
  state           TEXT,
  importance      REAL DEFAULT 0,
  access_count_30d INTEGER DEFAULT 0,
  last_accessed   TEXT,
  indexed_at      TEXT,
  staleness       REAL DEFAULT 0,
  access_count_30d_rolling REAL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  title, summary, body_text,
  content='pages',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS pages_ai
  AFTER INSERT ON pages BEGIN
    INSERT INTO pages_fts(rowid, title, summary, body_text)
    VALUES (new.rowid, new.title, new.summary, new.body_text);
  END;

CREATE TRIGGER IF NOT EXISTS pages_au
  AFTER UPDATE ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, title, summary, body_text)
    VALUES ('delete', old.rowid, old.title, old.summary, old.body_text);
    INSERT INTO pages_fts(rowid, title, summary, body_text)
    VALUES (new.rowid, new.title, new.summary, new.body_text);
  END;

CREATE TRIGGER IF NOT EXISTS pages_ad
  AFTER DELETE ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, title, summary, body_text)
    VALUES ('delete', old.rowid, old.title, old.summary, old.body_text);
  END;

-- Outbound links are keyed by the SOURCE page's vault-relative PATH, not its
-- slug: slugs are NOT unique (every directory has its own _index page — 24 of
-- them share slug _index in a real vault), so keying by from_slug collapsed
-- every hub page's outbound links into one shared row set and made backlinks fan
-- out across all same-slug pages. from_slug is retained for display + the
-- heuristic 2-hop search expansion; from_path is the identity.
CREATE TABLE IF NOT EXISTS links (
  from_path TEXT NOT NULL,
  from_slug TEXT NOT NULL,
  to_slug   TEXT NOT NULL,
  kind      TEXT NOT NULL DEFAULT 'wikilink',
  PRIMARY KEY (from_path, to_slug, kind)
);

CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_slug);
CREATE INDEX IF NOT EXISTS idx_links_from_path ON links(from_path);
CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);

CREATE TABLE IF NOT EXISTS wikilinks (
  slug      TEXT PRIMARY KEY,
  path      TEXT NOT NULL,
  ambiguous INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  ts      TEXT NOT NULL,
  page    TEXT,
  kind    TEXT,
  payload TEXT
);
`;

// pages_vec requires the vec extension to be loaded first.
const VEC_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS pages_vec USING vec0(embedding float[384]);
`;

export function openDb(dbPath: string): Database.Database {
  // Ensure the directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Wait (instead of throwing SQLITE_BUSY) when another process holds the
  // write lock — the MCP watcher and the web app may both open this DB and
  // an on-demand resync should never collide with a live watcher write.
  db.pragma('busy_timeout = 5000');

  // Attempt to load sqlite-vec extension
  let vecLoaded = false;

  // First try the `load` helper from sqlite-vec package (preferred API)
  try {
    const require = createRequire(import.meta.url);
    const sqliteVec = require('sqlite-vec') as { load?: (db: Database.Database) => void; getLoadablePath?: () => string };
    if (typeof sqliteVec.load === 'function') {
      sqliteVec.load(db);
      vecLoaded = true;
    }
  } catch {
    // fall through to manual path approach
  }

  if (!vecLoaded) {
    const vecPath = getSqliteVecPath();
    if (vecPath) {
      try {
        db.loadExtension(vecPath);
        vecLoaded = true;
      } catch (err) {
        // Extension load failure is non-fatal; vector search will be disabled
        console.warn(`[indexer] sqlite-vec extension not loaded (${String(err)}); vector search disabled.`);
      }
    } else {
      console.warn('[indexer] sqlite-vec path not found; vector search disabled.');
    }
  }

  // Destructive schema migration: the index is fully derived from the HTML
  // files on disk, so when the stored schema version is older than the code's
  // SCHEMA_VERSION we drop the rebuildable tables and let the next scan
  // repopulate them. (v1→v2 removed the UNIQUE constraint on pages.slug, which
  // SQLite cannot drop in place.)
  migrateDerivedSchema(db);

  // Apply DDL in a transaction
  db.exec(DDL);

  if (vecLoaded) {
    try {
      db.exec(VEC_DDL);
    } catch {
      // Table may already exist or vec not available
    }
  }

  // Seed schema version if fresh
  const versionRow = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined;
  if (!versionRow) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
  }

  return db;
}

/**
 * Drop derived tables when the stored schema version is older than the code's.
 * Safe to call before DDL: the dropped tables are recreated by DDL and
 * repopulated by the next full scan. The `events` table (access history) is
 * intentionally preserved. No-op on a fresh database.
 */
function migrateDerivedSchema(db: Database.Database): void {
  let storedVersion = 0;
  try {
    const hasTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`)
      .get() as { name: string } | undefined;
    if (!hasTable) return; // fresh DB — nothing to migrate
    const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
      | { version: number }
      | undefined;
    storedVersion = row?.version ?? 0;
  } catch {
    return;
  }

  if (storedVersion >= SCHEMA_VERSION) return;

  console.warn(
    `[indexer] migrating index schema v${storedVersion} → v${SCHEMA_VERSION}; ` +
      `rebuilding derived tables (a full scan will repopulate them).`
  );

  try {
    db.exec('DROP TABLE IF EXISTS pages_vec;');
  } catch {
    // vec extension may be unavailable; ignore
  }
  db.exec(`
    DROP TRIGGER IF EXISTS pages_ai;
    DROP TRIGGER IF EXISTS pages_au;
    DROP TRIGGER IF EXISTS pages_ad;
    DROP TABLE IF EXISTS pages_fts;
    DROP TABLE IF EXISTS links;
    DROP TABLE IF EXISTS wikilinks;
    DROP TABLE IF EXISTS pages;
    DROP TABLE IF EXISTS schema_version;
  `);
}

/** Open an in-memory DB (for tests). Vec extension is still attempted. */
export function openInMemoryDb(): Database.Database {
  return openDb(':memory:');
}
