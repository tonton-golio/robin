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
}): string {
  const { slug, vaultRelativePath, frontmatter, blocks, bodyHtml, updated } = opts;

  // Delegate to the converter's canonical assembler — the single source of
  // truth shared with the web write path. Builds the head meta tags from a
  // normalized RobinMeta and emits the v0.2 document shape (no JSON script
  // payloads in <head>; <article> body is canonical).
  const fm: Record<string, unknown> = { ...frontmatter, slug };
  const title = typeof fm['title'] === 'string' ? (fm['title'] as string) : slug;
  const { meta } = normalizeFrontmatter({
    frontmatter: fm,
    slug,
    outputPath: vaultRelativePath,
    title,
    updated: updated ?? new Date(),
  });

  return canonicalizeHtml({
    meta,
    frontmatter: fm,
    blocks: blocks ?? [],
    bodyHtml,
    updatedAt: updated,
  });
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
  // Workspace clones and tooling — not part of the knowledge vault.
  // (The app itself now lives outside the vault, so its old in-vault dir name
  // is no longer relevant; 'app' guards against a nested app dir if present.)
  'repos',
  'app',
  'tools',
]);

/**
 * Recursively collect Robin HTML files under `dir`, skipping dotfiles and any
 * directory in {@link IGNORED_DIRS}. Shared by vault.lint, vault.stats, and
 * page.list so they scan exactly the knowledge vault (brain/, out/, inbox/).
 */
export function findVaultHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findVaultHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(full);
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
