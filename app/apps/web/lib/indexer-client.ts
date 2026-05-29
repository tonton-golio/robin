/**
 * Thin wrapper around @robin/indexer.
 * If the indexer is importable, use it; else fall back to in-process filesystem
 * scan + naive text search (BM25 stub).
 */

import path from 'path';
import fs from 'fs/promises';
import { locateVault } from './vault';

export interface SearchHit {
  slug: string;
  path: string; // vault-relative
  title: string;
  summary?: string;
  score: number;
  type?: string;
}

export interface SearchResult {
  hits: SearchHit[];
  mode: 'indexer' | 'fallback';
  query: string;
}

export interface BacklinkEntry {
  slug: string;
  path: string;
  title: string;
  type?: string;
}

export interface ReindexResult {
  /** Pages (re)indexed */
  indexed: number;
  /** Files that errored during indexing */
  errors: number;
  /** Total resolved wikilinks in the index */
  wikilinks: number;
  /**
   * False when no link count is available (e.g. the real indexer is absent and
   * the fallback could not compute links). When false the UI must not report
   * "0 links" — it should say the index/links are unavailable instead.
   */
  wikilinksKnown: boolean;
  /** Wikilink targets that resolve to more than one page */
  ambiguous: number;
  /** Whether the real indexer ran, or we fell back to a file count */
  mode: 'indexer' | 'fallback';
  /** Wall-clock duration in milliseconds */
  durationMs: number;
}

interface IndexerInstance {
  scan: () => Promise<{ indexed: number; errors: number; wikilinks: number; ambiguous: number }>;
  search: (q: string, opts?: { k?: number }) => Promise<SearchHit[]>;
  getBacklinks: (slug: string) => Promise<BacklinkEntry[]>;
}

// The indexer is cached on `globalThis`, NOT at module scope. createIndexer()
// schedules a (correctly unref'd) nightly decay-sweep timer, and Next.js dev/HMR
// re-evaluates this module on edits — a plain module-level `let` does not survive
// that, so each reload would build a fresh indexer and leak another timer. Pinning
// it to the process-global guarantees createIndexer (and its timer) runs once.
interface IndexerCache {
  instance: IndexerInstance | null;
  loadPromise: Promise<void> | null;
}

const GLOBAL_KEY = Symbol.for('robin.indexerClient');
type GlobalWithIndexer = typeof globalThis & { [GLOBAL_KEY]?: IndexerCache };
const globalWithIndexer = globalThis as GlobalWithIndexer;

function indexerCache(): IndexerCache {
  return (globalWithIndexer[GLOBAL_KEY] ??= { instance: null, loadPromise: null });
}

async function loadIndexer(): Promise<void> {
  const cache = indexerCache();
  if (cache.loadPromise) return cache.loadPromise;
  cache.loadPromise = (async () => {
    try {
      // Use a computed module name so Turbopack/webpack doesn't statically analyze it
      // as a missing dependency. The try/catch handles the runtime error gracefully.
      const pkgName = '@robin' + '/indexer';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod: { createIndexer?: (opts: { vaultPath: string }) => Promise<IndexerInstance> } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require(pkgName) as { createIndexer?: (opts: { vaultPath: string }) => Promise<IndexerInstance> };
      if (typeof mod.createIndexer === 'function') {
        cache.instance = await mod.createIndexer({ vaultPath: locateVault() });
      }
    } catch {
      // @robin/indexer not available — use fallback
      cache.instance = null;
    }
  })();
  return cache.loadPromise;
}

function getIndexer(): IndexerInstance | null {
  return indexerCache().instance;
}

// Kick off indexer load (non-blocking)
void loadIndexer();

/**
 * Re-index the vault on demand (the "Resync" action).
 * Runs a real full scan when the indexer is available; otherwise reports a
 * file count so the UI still gives honest feedback.
 */
export async function reindex(): Promise<ReindexResult> {
  const started = Date.now();
  await loadIndexer();
  const indexer = getIndexer();

  if (indexer) {
    const r = await indexer.scan();
    return {
      indexed: r.indexed,
      errors: r.errors,
      wikilinks: r.wikilinks,
      wikilinksKnown: true,
      ambiguous: r.ambiguous,
      mode: 'indexer',
      durationMs: Date.now() - started,
    };
  }

  // Fallback: no indexer available — count the HTML files we would have indexed
  // and the wikilinks they reference, so the UI still reports honest numbers
  // instead of a misleading "0 links".
  const vault = locateVault();
  const files = await collectHtmlFiles(vault);
  const wikilinks = await countWikilinks(vault, files);
  return {
    indexed: files.length,
    errors: 0,
    wikilinks,
    wikilinksKnown: true,
    ambiguous: 0,
    mode: 'fallback',
    durationMs: Date.now() - started,
  };
}

/**
 * Count wikilink references across the given HTML files. Mirrors the indexer's
 * notion of a link: `data-wiki="..."` attributes emitted by the converter.
 * Used by the fallback path so resync reports a real link count.
 */
async function countWikilinks(vault: string, files: string[]): Promise<number> {
  const pattern = /data-wiki=["'][^"']+["']/gi;
  const counts = await Promise.all(
    files.map(async (rel) => {
      let text: string;
      try {
        text = await fs.readFile(path.join(vault, rel), 'utf-8');
      } catch {
        return 0;
      }
      return text.match(pattern)?.length ?? 0;
    }),
  );
  return counts.reduce((sum, n) => sum + n, 0);
}

/**
 * Search the vault.
 */
export async function search(query: string, k = 20): Promise<SearchResult> {
  await loadIndexer();
  const indexer = getIndexer();
  if (indexer) {
    try {
      const hits = await indexer.search(query, { k });
      return { hits, mode: 'indexer', query };
    } catch {
      // Fall through to fallback
    }
  }
  return fallbackSearch(query, k);
}

/**
 * Get backlinks — pages that link TO the given slug.
 */
export async function getBacklinks(slug: string): Promise<BacklinkEntry[]> {
  await loadIndexer();
  const indexer = getIndexer();
  if (indexer) {
    try {
      return await indexer.getBacklinks(slug);
    } catch {
      // Fall through
    }
  }
  return fallbackBacklinks(slug);
}

// ── Fallback implementations ──────────────────────────────────────────────────

/**
 * Naive fallback search: grep HTML files for the query terms.
 * Returns at most k results, sorted by rough score (term frequency).
 */
async function fallbackSearch(query: string, k: number): Promise<SearchResult> {
  const vault = locateVault();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { hits: [], mode: 'fallback', query };

  const files = await collectHtmlFiles(vault);
  const hits: SearchHit[] = [];

  await Promise.all(
    files.map(async (rel) => {
      const absPath = path.join(vault, rel);
      let text: string;
      try { text = await fs.readFile(absPath, 'utf-8'); }
      catch { return; }

      const lower = text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        let idx = 0;
        while ((idx = lower.indexOf(term, idx)) !== -1) {
          score++;
          idx += term.length;
        }
      }
      if (score === 0) return;

      // Extract title from <title> tag
      const titleMatch = /<title>([^<]*)<\/title>/i.exec(text);
      const title = titleMatch?.[1] ?? path.basename(rel, '.html');

      // Extract summary
      const summaryMatch = /robin:summary"[^>]*content="([^"]+)"/i.exec(text);
      const summary = summaryMatch?.[1];

      // Extract type
      const typeMatch = /robin:type"[^>]*content="([^"]+)"/i.exec(text);
      const type = typeMatch?.[1];

      // Extract slug
      const slugMatch = /robin:slug"[^>]*content="([^"]+)"/i.exec(text);
      const slug = slugMatch?.[1] ?? path.basename(rel, '.html');

      hits.push({ slug, path: rel, title, summary, score, type });
    }),
  );

  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, k), mode: 'fallback', query };
}

/**
 * Fallback backlinks: scan all HTML files for data-wiki="{slug}" references.
 */
async function fallbackBacklinks(slug: string): Promise<BacklinkEntry[]> {
  const vault = locateVault();
  const files = await collectHtmlFiles(vault);
  const results: BacklinkEntry[] = [];
  const pattern = new RegExp(`data-wiki=["']${escapeRegex(slug)}["']`, 'i');

  await Promise.all(
    files.map(async (rel) => {
      const absPath = path.join(vault, rel);
      let text: string;
      try { text = await fs.readFile(absPath, 'utf-8'); }
      catch { return; }

      if (!pattern.test(text)) return;

      const titleMatch = /<title>([^<]*)<\/title>/i.exec(text);
      const title = titleMatch?.[1] ?? path.basename(rel, '.html');
      const slugMatch = /robin:slug"[^>]*content="([^"]+)"/i.exec(text);
      const entrySlug = slugMatch?.[1] ?? path.basename(rel, '.html');
      const typeMatch = /robin:type"[^>]*content="([^"]+)"/i.exec(text);
      const type = typeMatch?.[1];

      results.push({ slug: entrySlug, path: rel, title, type });
    }),
  );

  return results;
}

async function collectHtmlFiles(vault: string): Promise<string[]> {
  const result: string[] = [];
  for (const dir of ['brain', 'out']) {
    const absDir = path.join(vault, dir);
    await walkForHtml(absDir, vault, result);
  }
  return result;
}

async function walkForHtml(dir: string, vault: string, result: string[]): Promise<void> {
  let entries: import('fs').Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.')) await walkForHtml(full, vault, result);
    } else if (e.isFile() && e.name.endsWith('.html')) {
      result.push(full.slice(vault.length).replace(/^\//, ''));
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
