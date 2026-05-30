/**
 * Utilities for reading and writing Robin HTML pages.
 *
 * Reading: uses parseRobinHtml from @robin/indexer.
 * Writing: assembles a new HTML document from parts and writes atomically.
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { convertMarkdown, canonicalizeHtml, normalizeFrontmatter, extractMetaFromMap } from '@robin/converter';
import { parseRobinHtml } from '@robin/indexer';
import type { RobinBlock, RobinMeta } from '@robin/converter';
import type { ParsedPage } from '@robin/indexer';

export { parseRobinHtml };
export type { ParsedPage };

/**
 * Read a Robin HTML file and return the parsed page.
 */
export async function readPage(absolutePath: string): Promise<ParsedPage> {
  const html = await fs.readFile(absolutePath, 'utf8');
  return parseRobinHtml(html);
}

/**
 * Read a Robin HTML file and return BOTH the parsed page and the raw HTML.
 *
 * Frontmatter-only rewrites (task.update, link.add) re-assemble the page from a
 * RobinMeta extracted out of the <head> meta tags. That extraction is lossy in
 * two ways the assembler can't recover on its own: the human <title> (which
 * lives only in <title>, not in any robin:* tag) and any robin:* meta key
 * outside the vocabulary (robin:workflow, robin:category, robin:review-by, …).
 * Callers that rewrite need the raw HTML to harvest those back, so expose it
 * alongside the parsed page.
 */
export async function readPageWithRaw(
  absolutePath: string
): Promise<{ parsed: ParsedPage; html: string }> {
  const html = await fs.readFile(absolutePath, 'utf8');
  return { parsed: parseRobinHtml(html), html };
}

/** Extract the document <title> text from raw page HTML (empty if absent). */
export function extractTitle(html: string): string {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return '';
  // Unescape the minimal entities canonicalizeHtml's escapeAttr emits.
  return m[1]!
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * robin:* meta names the canonical writer (metaTagsForHead) emits from a
 * RobinMeta. Any robin:* tag on a page NOT in this set is "unknown" — it
 * round-trips via raw frontmatter only and is dropped by a meta-only rebuild.
 * `robin:state` is intentionally included: it is a synonym folded into
 * robin:status on write, so we must NOT re-emit it as an extra tag.
 */
const CANONICAL_ROBIN_META = new Set([
  'robin:version',
  'robin:slug',
  'robin:path',
  'robin:type',
  'robin:updated',
  'robin:created',
  'robin:summary',
  'robin:status',
  'robin:state',
  'robin:owner',
  'robin:priority',
  'robin:size',
  'robin:due',
  'robin:role',
  'robin:relationship',
  'robin:started',
  'robin:date',
  'robin:duration',
  'robin:tier',
  'robin:tag',
  'robin:attendee',
  'robin:source',
]);

/**
 * Collect the robin:* <meta> tags that the canonical writer does NOT re-emit,
 * so a frontmatter-only rewrite can splice them back into the <head> instead of
 * silently dropping custom metadata (robin:workflow, robin:category, …).
 * Returns [name, content] pairs, one per value of a repeated tag.
 */
export function extractUnknownMetaTags(parsed: ParsedPage): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const m = parsed.meta as Record<string, string | string[]>;
  for (const [name, value] of Object.entries(m)) {
    if (!name.startsWith('robin:')) continue;
    if (CANONICAL_ROBIN_META.has(name)) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) out.push([name, v]);
  }
  return out;
}

/**
 * Extract RobinMeta from a ParsedPage's meta record.
 *
 * Delegates to the canonical @robin/converter extractor so the MCP server, the
 * web app, and the indexer all derive RobinMeta identically (no more
 * status-vs-state / dropped-`size` drift). The indexer's `ParsedPage.meta`
 * collapses single-valued keys to a bare string, so re-normalize to the
 * array-valued, fully-qualified map the canonical extractor expects.
 */
export function extractMeta(parsed: ParsedPage, vaultRelativePath: string): RobinMeta {
  const m = parsed.meta as Record<string, string | string[]>;
  const metaMap: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(m)) {
    metaMap[name] = Array.isArray(value) ? value : [value];
  }
  return extractMetaFromMap(metaMap, vaultRelativePath);
}

/**
 * Write a Robin HTML file atomically (tmp + rename).
 * Returns the final html string written.
 */
export async function writePage(
  absolutePath: string,
  html: string
): Promise<void> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const tmp = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, html, 'utf8');
  await fs.rename(tmp, absolutePath);
}

/**
 * Merge new frontmatter fields into the existing raw frontmatter object.
 * Passing null for a field clears it.
 */
export function mergeFrontmatter(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) {
      delete merged[k];
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

/**
 * Convert body_md to RobinBlock[] using the converter.
 */
export function mdToBlocks(
  bodyMd: string,
  outputPath: string
): RobinBlock[] {
  const result = convertMarkdown(bodyMd, { outputPath });
  return result.blocks;
}

/**
 * Assemble a complete Robin HTML document from parts via the converter's
 * canonical assembler (shared with the web write path).
 */
export function assemblePage(opts: {
  slug: string;
  vaultRelativePath: string;
  frontmatter: Record<string, unknown>;
  /** Source body as blocks. Mutually exclusive with bodyHtml. */
  blocks?: RobinBlock[];
  /**
   * v0.2 path: pre-rendered body HTML to splice into <article data-robin-doc>
   * verbatim. Used when updating frontmatter on a page whose body is already
   * the source of truth on disk and should not be re-rendered through blocks.
   */
  bodyHtml?: string;
  updated?: Date;
  /**
   * The human <title> to preserve on a frontmatter-only rewrite. RobinMeta has
   * no title field, so a meta-only rebuild otherwise falls back to the slug and
   * silently clobbers the page title. Threaded into frontmatter.title (which
   * canonicalizeHtml uses) when frontmatter doesn't already carry one.
   */
  title?: string;
  /**
   * robin:* <meta> tags the canonical writer does not re-emit (robin:workflow,
   * robin:category, …). Spliced back into <head> after canonicalization so a
   * frontmatter-only rewrite preserves custom metadata. Pairs of [name, content].
   */
  extraMeta?: Array<[string, string]>;
}): string {
  const { slug, vaultRelativePath, frontmatter, blocks, bodyHtml, updated, title: titleOpt, extraMeta } = opts;

  // Delegate to the converter's canonical assembler — the single source of
  // truth shared with the web write path. Builds the head meta tags from a
  // normalized RobinMeta and emits the v0.2 document shape (no JSON script
  // payloads in <head>; <article> body is canonical).
  const fm: Record<string, unknown> = { ...frontmatter, slug };
  // Preserve the human title: prefer an explicit frontmatter title, then the
  // caller-provided original <title>, then the slug as a last resort.
  if (typeof fm['title'] !== 'string' && titleOpt) fm['title'] = titleOpt;
  const title = typeof fm['title'] === 'string' ? (fm['title'] as string) : slug;
  const { meta } = normalizeFrontmatter({
    frontmatter: fm,
    slug,
    outputPath: vaultRelativePath,
    title,
    updated: updated ?? new Date(),
  });

  let html = canonicalizeHtml({
    meta,
    frontmatter: fm,
    blocks: blocks ?? [],
    bodyHtml,
    updatedAt: updated,
  });

  // Re-emit unknown robin:* meta tags the writer cannot express via RobinMeta.
  // canonicalizeHtml closes the <head> with the canonical meta block followed by
  // a newline + </head>; splice ours in just before it so they live in <head>
  // and survive the next read (parsed.meta picks up every robin:* tag).
  if (extraMeta && extraMeta.length > 0) {
    const tagsHtml = extraMeta
      .map(([name, content]) => `  <meta name="${escapeMetaAttr(name)}" content="${escapeMetaAttr(content)}">`)
      .join('\n');
    html = html.replace('\n</head>', `\n${tagsHtml}\n</head>`);
  }

  return html;
}

/** Mirror canonicalizeHtml's escapeAttr so spliced meta tags match its escaping. */
function escapeMetaAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Serialize log appends within the process. appendLog is a read-modify-write
// (prepend), so two concurrent calls would both read the old content and the
// last rename would clobber the other's entry. Chaining them guarantees each
// reads the result of the previous.
let appendChain: Promise<unknown> = Promise.resolve();

/**
 * Atomic, serialized append to a markdown log file under logs/ (prepend =
 * newest at top).
 */
export async function appendLog(
  vault: string,
  file: 'changelog' | 'ingest' | 'repo',
  entryMd: string
): Promise<number> {
  const run = appendChain.then(() => doAppendLog(vault, file, entryMd));
  // Keep the chain alive even if one append rejects.
  appendChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function doAppendLog(
  vault: string,
  file: 'changelog' | 'ingest' | 'repo',
  entryMd: string
): Promise<number> {
  const target = path.join(
    vault,
    'logs',
    file === 'changelog' ? 'changelog.md' : file === 'ingest' ? 'ingest-log.md' : 'repo-log.md'
  );
  const current = await fs.readFile(target, 'utf8').catch(() => '');
  // Header injection: if entry doesn't start with '## [', prepend a date stamp
  const stamped = /^##\s*\[/.test(entryMd.trimStart())
    ? entryMd
    : `## [${new Date().toISOString().slice(0, 10)}]\n\n${entryMd}`;
  const next = stamped.trimEnd() + '\n\n' + current.trimStart();
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(tmp, next, 'utf8');
  await fs.rename(tmp, target);
  return Buffer.byteLength(next, 'utf8');
}

/**
 * Directory names that never contain Robin knowledge pages and must be skipped
 * when walking the vault. Without this, vendored HTML (node_modules demos,
 * Python site-packages, build output) and workspace clones under repos/ flood
 * lint/stats/list results with thousands of false positives.
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  'venv',
  '.venv',
  '__pycache__',
  'site-packages',
  'dist',
  'build',
  'coverage',
  '.next',
  '.git',
]);

/**
 * Names that legitimately appear BOTH as knowledge subdirs under `brain/`
 * (brain/repos, brain/tools) AND as workspace-clone / framework dirs at the
 * vault root (base/repos, base/tools). We must skip only the root-level ones —
 * a basename match at any depth would also prune brain/repos and brain/tools,
 * making their pages invisible to lint/stats/list and falsely flagging every
 * [[repos/_index]] / [[tools/_index]] link as broken. So these are
 * path-anchored: skipped only when they sit directly at the vault root.
 */
const ROOT_ONLY_IGNORED_DIRS = new Set(['repos', 'app', 'tools']);

/**
 * Recursively collect Robin HTML files under `dir`, skipping dotfiles and any
 * directory in {@link IGNORED_DIRS}. `ROOT_ONLY_IGNORED_DIRS` are pruned only at
 * the vault root (`rootDir`), never under brain/. Shared by vault.lint,
 * vault.stats, and page.list so they scan exactly the knowledge vault
 * (brain/, out/, inbox/, logs/).
 */
export function findVaultHtmlFiles(dir: string, rootDir: string = dir): string[] {
  const results: string[] = [];
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      // Path-anchored: only prune repos/app/tools when they are direct children
      // of the vault root (workspace clones / framework dirs), not the
      // knowledge subdirs brain/repos and brain/tools.
      if (dir === rootDir && ROOT_ONLY_IGNORED_DIRS.has(entry.name)) continue;
      results.push(...findVaultHtmlFiles(path.join(dir, entry.name), rootDir));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

/**
 * Slugify a title to a valid Robin slug.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
