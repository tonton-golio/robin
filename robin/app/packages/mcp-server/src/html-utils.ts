/**
 * Utilities for reading and writing Robin HTML pages.
 *
 * Reading: uses parseRobinHtml from @robin/indexer.
 * Writing: assembles a new HTML document from parts and writes atomically.
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import {
  convertMarkdown,
  canonicalizeHtml,
  normalizeFrontmatter,
  extractMetaFromMap,
  collectExtraMetaTags,
} from "@robin/converter";
import { parseRobinHtml } from "@robin/indexer";
import { durableReplace, withVaultLocks, writeWithHistory } from "@robin/vault-io";
import type { RobinBlock, RobinMeta } from "@robin/converter";
import type { ParsedPage } from "@robin/indexer";

export { parseRobinHtml };
export type { ParsedPage };

/**
 * Read a Robin HTML file and return the parsed page.
 */
export async function readPage(absolutePath: string): Promise<ParsedPage> {
  const html = await fs.readFile(absolutePath, "utf8");
  return parseRobinHtml(html);
}

/**
 * Read a Robin HTML file and return BOTH the parsed page and the raw HTML.
 *
 * Frontmatter-only rewrites (task.update, link.add) re-assemble the page from a
 * RobinMeta extracted out of the <head> meta tags. That extraction is lossy in
 * two ways the assembler can't recover on its own: the human <title> (which
 * lives only in <title>, not in any robin:* tag) and any robin:* meta key
 * outside the vocabulary (robin:review-by, and other custom tags).
 * Callers that rewrite need the raw HTML to harvest those back, so expose it
 * alongside the parsed page.
 */
export async function readPageWithRaw(
  absolutePath: string,
): Promise<{ parsed: ParsedPage; html: string }> {
  const html = await fs.readFile(absolutePath, "utf8");
  return { parsed: parseRobinHtml(html), html };
}

/** Extract the document <title> text from raw page HTML (empty if absent). */
export function extractTitle(html: string): string {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return "";
  // Unescape the minimal entities canonicalizeHtml's escapeAttr emits.
  return m[1]!
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Collect the robin:* <meta> tags that the canonical writer does NOT re-emit,
 * so a frontmatter-only rewrite can splice them back into the <head> instead of
 * silently dropping custom metadata (robin:review-by, …). Delegates to the
 * shared @robin/converter collector so the canonical-name vocabulary lives in
 * exactly one place (no drift when a field is promoted to first-class, as
 * robin:category / robin:planned were). Returns [name, content] pairs, one per
 * value of a repeated tag.
 */
export function extractUnknownMetaTags(parsed: ParsedPage): Array<[string, string]> {
  const m = parsed.meta as Record<string, string | string[]>;
  const metaMap: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(m)) {
    metaMap[name] = Array.isArray(value) ? value : [value];
  }
  return collectExtraMetaTags(metaMap);
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
 * Per-request write context, set by the MCP dispatch wrapper (server.ts) before
 * each tool handler runs and cleared after. MCP CallTool dispatch is serial (one
 * awaited request at a time), so a module-level holder is safe and lets writePage
 * attribute every page mutation — vault root + tool name — without threading
 * context through every tool. This is the "interceptor" from
 * robin/app/docs/edit-log-ingest.md.
 */
interface McpWriteContext {
  vaultRoot: string;
  tool: string;
  refresh?: (paths: string[]) => Promise<unknown>;
}

let mcpWriteContext: McpWriteContext | null = null;

export function setMcpWriteContext(ctx: McpWriteContext | null): void {
  mcpWriteContext = ctx;
}

/**
 * Write a Robin HTML file atomically via the shared @robin/vault-io choke point
 * (origin: 'mcp'). The choke point does the atomic tmp+rename and the
 * content-hash no-op; when the dispatch wrapper has set a write context, it also
 * snapshots prior bytes to .history/ and appends an edit event tagged with the
 * MCP tool name. Path resolution/validation stays in the calling tool.
 */
export async function writePage(
  absolutePath: string,
  html: string,
  options: { expectedHash?: string | null } = {},
): Promise<void> {
  const result = await writeWithHistory({
    absolutePath,
    html,
    origin: "mcp",
    expectedHash: options.expectedHash,
    ...(mcpWriteContext
      ? { vaultRoot: mcpWriteContext.vaultRoot, tool: mcpWriteContext.tool }
      : {}),
  });
  if (result.written && mcpWriteContext?.refresh) {
    const relativePath = path
      .relative(mcpWriteContext.vaultRoot, absolutePath)
      .split(path.sep)
      .join("/");
    await mcpWriteContext.refresh([relativePath]).catch((error) => {
      // The canonical write is already durable. A failed derived-index refresh
      // must not make the caller retry a mutation that actually committed; the
      // filesystem watcher or an explicit index.refresh can repair the index.
      console.error(
        `Robin index refresh failed after writing ${relativePath}:`,
        error instanceof Error ? error.message : String(error),
      );
    });
  }
}

/**
 * Merge new frontmatter fields into the existing raw frontmatter object.
 * Passing null for a field clears it.
 */
export function mergeFrontmatter(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
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
export function mdToBlocks(bodyMd: string, outputPath: string): RobinBlock[] {
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
   * Version-preserving path: pre-rendered body HTML to splice into
   * <article data-robin-doc> verbatim. Used when updating frontmatter on a
   * v0.2 or staged-v0.3 page whose body is already the source of truth on disk
   * and should not be re-rendered through blocks.
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
   * robin:* <meta> tags the canonical writer does not re-emit (robin:review-by,
   * and other custom tags). Spliced back into <head> after canonicalization so a
   * frontmatter-only rewrite preserves custom metadata. Pairs of [name, content].
   */
  extraMeta?: Array<[string, string]>;
}): string {
  const {
    slug,
    vaultRelativePath,
    frontmatter,
    blocks,
    bodyHtml,
    updated,
    title: titleOpt,
    extraMeta,
  } = opts;

  // Delegate to the converter's canonical assembler — the single source of
  // truth shared with the web write path. Builds the head meta tags from a
  // normalized RobinMeta and emits the current HTML document shape (v0.2 by
  // default, staged v0.3 when explicitly requested; no JSON script payloads in
  // <head>; <article> body is canonical).
  const fm: Record<string, unknown> = { ...frontmatter, slug };
  // Preserve the human title: prefer an explicit frontmatter title, then the
  // caller-provided original <title>, then the slug as a last resort.
  if (typeof fm["title"] !== "string" && titleOpt) fm["title"] = titleOpt;
  const title = typeof fm["title"] === "string" ? (fm["title"] as string) : slug;
  const { meta } = normalizeFrontmatter({
    frontmatter: fm,
    slug,
    outputPath: vaultRelativePath,
    title,
    updated: updated ?? new Date(),
  });

  // Unknown robin:* meta tags the writer cannot express via RobinMeta are
  // threaded into canonicalizeHtml's `extraMeta` — the single shared splice
  // implementation — so they survive the next read (parsed.meta picks up every
  // robin:* tag) without a second copy of the emit logic here.
  return canonicalizeHtml({
    meta,
    frontmatter: fm,
    blocks: blocks ?? [],
    bodyHtml,
    updatedAt: updated,
    extraMeta,
  });
}

/**
 * Atomic, cross-process serialized update to a Markdown log materialized view
 * under logs/ (prepend = newest at top).
 */
export async function appendLog(
  vault: string,
  file: "changelog" | "ingest" | "repo",
  entryMd: string,
): Promise<number> {
  const relativePath =
    file === "changelog"
      ? "logs/changelog.md"
      : file === "ingest"
        ? "logs/ingest-log.md"
        : "logs/repo-log.md";
  return withVaultLocks(vault, [`view:${relativePath}`], () => doAppendLog(vault, file, entryMd));
}

async function doAppendLog(
  vault: string,
  file: "changelog" | "ingest" | "repo",
  entryMd: string,
): Promise<number> {
  const target = path.join(
    vault,
    "logs",
    file === "changelog" ? "changelog.md" : file === "ingest" ? "ingest-log.md" : "repo-log.md",
  );
  const current = await fs.readFile(target, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  // Header injection: if entry doesn't start with '## [', prepend a date stamp
  const stamped = /^##\s*\[/.test(entryMd.trimStart())
    ? entryMd
    : `## [${new Date().toISOString().slice(0, 10)}]\n\n${entryMd}`;
  const next = stamped.trimEnd() + "\n\n" + current.trimStart();
  await durableReplace(target, next);
  return Buffer.byteLength(next, "utf8");
}

/**
 * Directory names that never contain Robin knowledge pages and must be skipped
 * when walking the vault. Without this, vendored HTML (node_modules demos,
 * Python site-packages, build output) and workspace clones under repos/ flood
 * lint/stats/list results with thousands of false positives.
 */
const IGNORED_DIRS = new Set([
  "node_modules",
  "venv",
  ".venv",
  "__pycache__",
  "site-packages",
  "dist",
  "build",
  "coverage",
  ".next",
  ".git",
]);

/**
 * Names that legitimately appear BOTH as knowledge subdirs under `brain/`
 * (brain/repos, brain/tools) AND as workspace-clone / framework dirs at the
 * vault root (repos/, tools/). We must skip only the root-level ones —
 * a basename match at any depth would also prune brain/repos and brain/tools,
 * making their pages invisible to lint/stats/list and falsely flagging every
 * [[repos/_index]] / [[tools/_index]] link as broken. So these are
 * path-anchored: skipped only when they sit directly at the vault root.
 */
const ROOT_ONLY_IGNORED_DIRS = new Set(["repos", "app", "tools"]);

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
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      // Path-anchored: only prune repos/app/tools when they are direct children
      // of the vault root (workspace clones / framework dirs), not the
      // knowledge subdirs brain/repos and brain/tools.
      if (dir === rootDir && ROOT_ONLY_IGNORED_DIRS.has(entry.name)) continue;
      results.push(...findVaultHtmlFiles(path.join(dir, entry.name), rootDir));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
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
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
