/**
 * Thin wrapper around @robin/indexer.
 * If the indexer is importable, use it; else fall back to in-process filesystem
 * scan + naive text search (BM25 stub).
 */

import path from "path";
import fs from "fs/promises";
import { locateVault } from "./vault";
import { listBrainPages, type CatalogPage } from "./catalog";
import { readPage } from "./read-page";
import { isArchivePath } from "./archive";

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
  mode: "indexer" | "fallback";
  query: string;
}

export interface BacklinkEntry {
  slug: string;
  path: string;
  title: string;
  type?: string;
}

export interface ConnectionPageRef {
  path: string;
  slug: string;
  title: string;
  type?: string;
  summary?: string;
  updated?: string;
}

export interface PageConnection {
  page: ConnectionPageRef;
  kind: string;
  reason: string;
  score: number;
}

export interface ConnectionTrail {
  via: ConnectionPageRef;
  target: ConnectionPageRef;
  reason: string;
  score: number;
}

export interface LinkSuggestion {
  page: ConnectionPageRef;
  matchedText: string;
  reason: string;
  score: number;
}

export interface PageConnections {
  mode: "indexer" | "fallback";
  page: ConnectionPageRef;
  outbound: PageConnection[];
  backlinks: PageConnection[];
  trails: ConnectionTrail[];
  suggestions: LinkSuggestion[];
}

export interface PageConnectionOptions {
  trailLimit?: number;
  suggestionLimit?: number;
}

type IndexerPageConnections = Omit<PageConnections, "mode">;

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
  mode: "indexer" | "fallback";
  /** Wall-clock duration in milliseconds */
  durationMs: number;
}

interface IndexerInstance {
  scan: () => Promise<{ indexed: number; errors: number; wikilinks: number; ambiguous: number }>;
  refresh: (paths: string[]) => Promise<{
    indexed: number;
    removed: number;
    skipped: number;
    errors: Array<{ path: string; error: string }>;
  }>;
  watch?: () => unknown;
  search: (q: string, opts?: { k?: number }) => Promise<SearchHit[]>;
  getBacklinks: (slug: string) => Promise<BacklinkEntry[]>;
  getPageConnections?: (
    pagePath: string,
    opts?: PageConnectionOptions,
  ) => IndexerPageConnections | null;
}

// The indexer is cached on `globalThis`, NOT at module scope. createIndexer()
// schedules a (correctly unref'd) nightly decay-sweep timer, and Next.js dev/HMR
// re-evaluates this module on edits — a plain module-level `let` does not survive
// that, so each reload would build a fresh indexer and leak another timer. Pinning
// it to the process-global guarantees createIndexer (and its timer) runs once.
interface IndexerCache {
  instance: IndexerInstance | null;
  loadPromise: Promise<void> | null;
  lastError: string | null;
}

const GLOBAL_KEY = Symbol.for("robin.indexerClient");
type GlobalWithIndexer = typeof globalThis & { [GLOBAL_KEY]?: IndexerCache };
const globalWithIndexer = globalThis as GlobalWithIndexer;

function indexerCache(): IndexerCache {
  return (globalWithIndexer[GLOBAL_KEY] ??= {
    instance: null,
    loadPromise: null,
    lastError: null,
  });
}

async function loadIndexer(): Promise<void> {
  const cache = indexerCache();
  if (cache.instance) return;
  if (cache.loadPromise) return cache.loadPromise;
  cache.loadPromise = (async () => {
    try {
      // Use a computed module name so Turbopack/webpack doesn't statically analyze it
      // as a missing dependency. The try/catch handles the runtime error gracefully.
      const pkgName = "@robin" + "/indexer";
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod: { createIndexer?: (opts: { vaultPath: string }) => Promise<IndexerInstance> } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require(pkgName) as {
          createIndexer?: (opts: { vaultPath: string }) => Promise<IndexerInstance>;
        };
      if (typeof mod.createIndexer === "function") {
        const instance = await mod.createIndexer({ vaultPath: locateVault() });
        // Establish parity before serving indexed reads, then keep watching for
        // direct/manual writers that cannot call refresh explicitly.
        await instance.scan();
        instance.watch?.();
        cache.instance = instance;
        cache.lastError = null;
      }
    } catch (error) {
      // @robin/indexer not available — use fallback
      cache.instance = null;
      cache.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      // A failed initialization must be retryable; a permanently cached rejected
      // or resolved-no-index promise made degraded mode sticky until restart.
      cache.loadPromise = null;
    }
  })();
  return cache.loadPromise;
}

function getIndexer(): IndexerInstance | null {
  return indexerCache().instance;
}

// Deliberately lazy: importing a server module must not start a full vault scan
// or mutate the shared SQLite sidecar. Next production builds evaluate modules
// in parallel workers; eager initialization made every worker scan the same DB.
// Search, refresh, health-resync, and relationship calls all await loadIndexer()
// at their actual use boundary.

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
      mode: "indexer",
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
    mode: "fallback",
    durationMs: Date.now() - started,
  };
}

/** Incrementally refresh successful writes/moves/deletes in the live index. */
export async function refreshIndexPaths(paths: string[]): Promise<void> {
  await loadIndexer();
  const indexer = getIndexer();
  if (!indexer) {
    throw new Error(
      `index_unavailable: ${indexerCache().lastError ?? "indexer package did not initialize"}`,
    );
  }
  const result = await indexer.refresh(paths);
  if (result.errors.length) {
    throw new Error(
      `index_refresh_failed: ${result.errors
        .map((entry) => `${entry.path}: ${entry.error}`)
        .join("; ")}`,
    );
  }
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
        text = await fs.readFile(path.join(vault, rel), "utf-8");
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
      return { hits, mode: "indexer", query };
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

/**
 * Get relationship context for one page: explicit links, backlinks, nearby graph
 * trails, and unlinked mention candidates. The indexer path uses the compiled
 * SQLite graph; the fallback scans canonical brain pages directly so the UI still
 * works before a resync or when @robin/indexer is unavailable.
 */
export async function getPageConnections(
  pagePath: string,
  opts: PageConnectionOptions = {},
): Promise<PageConnections | null> {
  await loadIndexer();
  const indexer = getIndexer();
  if (indexer?.getPageConnections) {
    try {
      const connections = indexer.getPageConnections(pagePath, opts);
      if (connections) return { ...connections, mode: "indexer" };
    } catch {
      // Fall through to filesystem scan.
    }
  }
  return fallbackPageConnections(pagePath, opts);
}

// ── Fallback implementations ──────────────────────────────────────────────────

/**
 * Naive fallback search: grep HTML files for the query terms.
 * Returns at most k results, sorted by rough score (term frequency).
 */
export async function fallbackSearch(query: string, k: number, vault = locateVault()): Promise<SearchResult> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { hits: [], mode: "fallback", query };

  const files = await collectHtmlFiles(vault);
  const hits: SearchHit[] = [];

  await Promise.all(
    files.map(async (rel) => {
      const absPath = path.join(vault, rel);
      let text: string;
      try {
        text = await fs.readFile(absPath, "utf-8");
      } catch {
        return;
      }

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
      const title = titleMatch?.[1] ?? path.basename(rel, ".html");

      // Extract summary
      const summaryMatch = /robin:summary"[^>]*content="([^"]+)"/i.exec(text);
      const summary = summaryMatch?.[1];

      // Extract type
      const typeMatch = /robin:type"[^>]*content="([^"]+)"/i.exec(text);
      const type = typeMatch?.[1];

      // Extract slug
      const slugMatch = /robin:slug"[^>]*content="([^"]+)"/i.exec(text);
      const slug = slugMatch?.[1] ?? path.basename(rel, ".html");

      hits.push({ slug, path: rel, title, summary, score, type });
    }),
  );

  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, k), mode: "fallback", query };
}

/**
 * Fallback backlinks: scan all HTML files for data-wiki="{slug}" references.
 */
async function fallbackBacklinks(slug: string): Promise<BacklinkEntry[]> {
  const vault = locateVault();
  const files = await collectHtmlFiles(vault);
  const results: BacklinkEntry[] = [];
  const pattern = new RegExp(`data-wiki=["']${escapeRegex(slug)}["']`, "i");

  await Promise.all(
    files.map(async (rel) => {
      const absPath = path.join(vault, rel);
      let text: string;
      try {
        text = await fs.readFile(absPath, "utf-8");
      } catch {
        return;
      }

      if (!pattern.test(text)) return;

      const titleMatch = /<title>([^<]*)<\/title>/i.exec(text);
      const title = titleMatch?.[1] ?? path.basename(rel, ".html");
      const slugMatch = /robin:slug"[^>]*content="([^"]+)"/i.exec(text);
      const entrySlug = slugMatch?.[1] ?? path.basename(rel, ".html");
      const typeMatch = /robin:type"[^>]*content="([^"]+)"/i.exec(text);
      const type = typeMatch?.[1];

      results.push({ slug: entrySlug, path: rel, title, type });
    }),
  );

  return results;
}

async function fallbackPageConnections(
  pagePath: string,
  opts: PageConnectionOptions,
): Promise<PageConnections | null> {
  const trailLimit = positiveLimit(opts.trailLimit, 8);
  const suggestionLimit = positiveLimit(opts.suggestionLimit, 8);
  const pages = await listBrainPages();
  const current =
    pages.find((page) => page.path === pagePath) ?? pages.find((page) => page.slug === pagePath);
  if (!current) return null;

  const lookup = buildPageLookup(pages);
  const resolveTarget = (target: string): CatalogPage | null => {
    const exact = lookup.get(target);
    if (exact) return exact;
    if (target.includes("/")) {
      const base = target.slice(target.lastIndexOf("/") + 1);
      return lookup.get(base) ?? null;
    }
    return null;
  };

  const pageRef = toConnectionPageRef(current);
  const outbound = dedupeConnections(
    current.links
      .map((slug): PageConnection | null => {
        const page = resolveTarget(slug);
        if (!page || page.path === current.path) return null;
        return {
          page: toConnectionPageRef(page),
          kind: "wikilink",
          reason: `Links to ${page.title}`,
          score: 1,
        };
      })
      .filter((item): item is PageConnection => Boolean(item)),
  );

  const backlinks = dedupeConnections(
    pages
      .filter((page) => page.path !== current.path)
      .filter((page) => page.links.some((target) => resolveTarget(target)?.path === current.path))
      .map(
        (page): PageConnection => ({
          page: toConnectionPageRef(page),
          kind: "wikilink",
          reason: `${page.title} links here`,
          score: 1,
        }),
      ),
  );

  const directPaths = new Set([
    current.path,
    ...outbound.map((link) => link.page.path),
    ...backlinks.map((link) => link.page.path),
  ]);
  const trails = dedupeTrails(
    outbound.flatMap((link) => {
      const via = pages.find((page) => page.path === link.page.path);
      if (!via) return [];
      return via.links
        .map((targetSlug): ConnectionTrail | null => {
          const target = resolveTarget(targetSlug);
          if (!target || directPaths.has(target.path)) return null;
          return {
            via: link.page,
            target: toConnectionPageRef(target),
            reason: `${link.page.title} links onward to ${target.title}`,
            score: 2,
          };
        })
        .filter((item): item is ConnectionTrail => Boolean(item));
    }),
  ).slice(0, trailLimit);

  const suggestions = await fallbackLinkSuggestions(current, pages, directPaths, suggestionLimit);

  return {
    mode: "fallback",
    page: pageRef,
    outbound,
    backlinks,
    trails,
    suggestions,
  };
}

function buildPageLookup(pages: CatalogPage[]): Map<string, CatalogPage> {
  const lookup = new Map<string, CatalogPage>();
  for (const page of pages) {
    const keys = [
      page.slug,
      page.path,
      page.path.replace(/\.html$/, ""),
      page.path.replace(/^brain\//, "").replace(/\.html$/, ""),
      path.basename(page.path, ".html"),
    ];
    for (const key of keys) {
      if (!key) continue;
      const existing = lookup.get(key);
      if (!existing || (isArchivePath(existing.path) && !isArchivePath(page.path))) {
        lookup.set(key, page);
      }
    }
  }
  return lookup;
}

function toConnectionPageRef(page: CatalogPage): ConnectionPageRef {
  return {
    path: page.path,
    slug: page.slug,
    title: page.title,
    type: page.type,
    summary: page.summary,
    updated: page.updated,
  };
}

function dedupeConnections(connections: PageConnection[]): PageConnection[] {
  const seen = new Set<string>();
  const result: PageConnection[] = [];
  for (const connection of connections) {
    const key = `${connection.kind}:${connection.page.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(connection);
  }
  return result.sort(
    (a, b) => a.page.title.localeCompare(b.page.title) || a.page.path.localeCompare(b.page.path),
  );
}

function dedupeTrails(trails: ConnectionTrail[]): ConnectionTrail[] {
  const seen = new Set<string>();
  const result: ConnectionTrail[] = [];
  for (const trail of trails) {
    const key = `${trail.via.path}\u0000${trail.target.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trail);
  }
  return result.sort(
    (a, b) =>
      b.score - a.score ||
      a.via.title.localeCompare(b.via.title) ||
      a.target.title.localeCompare(b.target.title),
  );
}

async function fallbackLinkSuggestions(
  current: CatalogPage,
  pages: CatalogPage[],
  directPaths: Set<string>,
  limit: number,
): Promise<LinkSuggestion[]> {
  if (limit <= 0) return [];
  const page = await readPage(current.path);
  if ("error" in page) return [];

  const bodyText = normalizeTextForMatch(htmlToText(page.bodyHtml));
  if (!bodyText) return [];

  const suggestions: LinkSuggestion[] = [];
  for (const candidate of pages) {
    if (directPaths.has(candidate.path) || isArchivePath(candidate.path)) continue;
    const match = bestCandidateMention(bodyText, candidate);
    if (!match) continue;
    suggestions.push({
      page: toConnectionPageRef(candidate),
      matchedText: match.matchedText,
      reason: match.reason,
      score: match.score,
    });
  }

  return suggestions
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.page.title.localeCompare(b.page.title) ||
        a.page.path.localeCompare(b.page.path),
    )
    .slice(0, limit);
}

function bestCandidateMention(
  normalizedBodyText: string,
  candidate: CatalogPage,
): { matchedText: string; reason: string; score: number } | null {
  const title = candidate.title.trim();
  const slugPhrase = candidate.slug.replace(/[-_/]+/g, " ").trim();
  const variants = [
    { text: title, score: 100, reason: "Title appears in the page body without a wikilink" },
    {
      text: slugPhrase,
      score: 72,
      reason: "Slug phrase appears in the page body without a wikilink",
    },
  ];

  let best: { matchedText: string; reason: string; score: number } | null = null;
  for (const variant of variants) {
    if (!isUsefulMention(variant.text)) continue;
    const normalized = normalizeTextForMatch(variant.text);
    if (!hasWholePhrase(normalizedBodyText, normalized)) continue;
    const score = variant.score + typeSuggestionBoost(candidate.type);
    if (!best || score > best.score) {
      best = { matchedText: variant.text, reason: variant.reason, score };
    }
  }
  return best;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! >= 0 ? Math.floor(value!) : fallback;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeTextForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasWholePhrase(normalizedBodyText: string, normalizedPhrase: string): boolean {
  if (!normalizedPhrase) return false;
  return ` ${normalizedBodyText} `.includes(` ${normalizedPhrase} `);
}

function isUsefulMention(value: string): boolean {
  const normalized = normalizeTextForMatch(value);
  if (normalized.length < 4) return false;
  if (normalized.split(" ").length === 1 && normalized.length < 6) return false;
  return !new Set(["index", "brain", "task", "tasks", "project", "projects", "note", "notes"]).has(
    normalized,
  );
}

function typeSuggestionBoost(type: string | undefined): number {
  if (type === "person") return 12;
  if (type === "project") return 10;
  if (type === "decision") return 8;
  if (type === "knowledge" || type === "pattern" || type === "playbook") return 6;
  return 0;
}

async function collectHtmlFiles(vault: string): Promise<string[]> {
  const result: string[] = [];
  for (const dir of ["brain", "out", "logs/meetings", "logs/reports"]) {
    const absDir = path.join(vault, dir);
    await walkForHtml(absDir, vault, result);
  }
  return result;
}

async function walkForHtml(dir: string, vault: string, result: string[]): Promise<void> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith(".")) await walkForHtml(full, vault, result);
    } else if (e.isFile() && e.name.endsWith(".html")) {
      result.push(full.slice(vault.length).replace(/^\//, ""));
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
