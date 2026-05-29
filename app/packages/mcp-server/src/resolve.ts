/**
 * Slug/path resolution logic shared across all MCP tools.
 *
 * Resolution rule (from spec):
 *   - If ref ends in '.html' → treat as vault-relative path.
 *   - If ref is path-like (contains '/') → resolve by matching a page's
 *     vault-relative path by exact or suffix match (e.g. 'features/images'
 *     resolves 'brain/projects/foo/features/images.html'). This is how
 *     post-restructure wikilinks like 'foo/foo' or 'projects/_index' resolve
 *     even though the stored basename slug is just 'foo' or '_index'.
 *   - Otherwise → treat as a bare slug; query indexer wikilinks table.
 *   - If a ref is ambiguous → return MCP error -32602 with candidates.
 *   - Never silently pick one match when multiple exist.
 *
 * Fallback (no indexer): filesystem scan under vaultPath for *.html files
 * whose basename (or vault-relative path suffix) matches the ref.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolContext } from './types.js';

export interface ResolveResult {
  /** Vault-relative path, e.g. 'brain/risk-register.html' */
  vaultRelativePath: string;
  /** Absolute path on disk */
  absolutePath: string;
  /** Slug (basename without .html) */
  slug: string;
}

export interface AmbiguousError {
  kind: 'ambiguous';
  candidates: string[];
}

export interface NotFoundError {
  kind: 'not_found';
}

export type ResolveError = AmbiguousError | NotFoundError;

/**
 * Resolve a ref (slug or path) to an absolute path on disk.
 * Throws an MCP-compatible error object on ambiguity or not-found.
 */
export async function resolveRef(
  ref: string,
  ctx: ToolContext
): Promise<ResolveResult> {
  if (ref.endsWith('.html')) {
    // Path mode. Guard against traversal — this path feeds page.read/write/move
    // and page.delete (which unlinks), so a `../` ref must never escape the vault.
    if (ref.includes('\0')) {
      throw mcpError(-32602, `Invalid ref: ${ref}`, undefined);
    }
    const absolutePath = path.join(ctx.vaultPath, ref);
    const vaultRoot = path.resolve(ctx.vaultPath);
    const resolvedAbs = path.resolve(absolutePath);
    if (resolvedAbs !== vaultRoot && !resolvedAbs.startsWith(vaultRoot + path.sep)) {
      throw mcpError(-32602, `Ref escapes the vault: ${ref}`, undefined);
    }
    if (!fs.existsSync(absolutePath)) {
      throw mcpError(-32602, `Page not found: ${ref}`, undefined);
    }
    return {
      vaultRelativePath: ref,
      absolutePath,
      slug: path.basename(ref, '.html'),
    };
  }

  const slug = ref;
  const pathLike = ref.includes('/');

  // Try indexer first
  if (ctx.indexer) {
    try {
      // Path-like refs resolve against the pages table by path suffix.
      if (pathLike) {
        const paths = queryPagesByPathSuffix(ctx.indexer.db, ref);
        if (paths.length === 1) {
          const rel = paths[0]!;
          return {
            vaultRelativePath: rel,
            absolutePath: path.join(ctx.vaultPath, rel),
            slug: path.basename(rel, '.html'),
          };
        }
        if (paths.length > 1) {
          throw mcpError(
            -32602,
            `Ambiguous ref '${ref}': matches ${paths.length} pages`,
            { candidates: paths }
          );
        }
        // No path match → fall through to filesystem scan.
      } else {
        const rows = queryWikilinks(ctx.indexer.db, slug);
        if (rows.length === 1) {
          const row = rows[0]!;
          return {
            vaultRelativePath: row.path,
            absolutePath: path.join(ctx.vaultPath, row.path),
            slug,
          };
        }
        if (rows.length > 1) {
          throw mcpError(
            -32602,
            `Ambiguous slug '${slug}': matches ${rows.length} pages`,
            { candidates: rows.map((r) => r.path) }
          );
        }
      }
    } catch (err) {
      // If it's our own MCP error, rethrow
      if (isMcpError(err)) throw err;
      // Otherwise fall through to filesystem scan
    }
  }

  // Filesystem fallback (matches by basename slug or, for path-like refs,
  // by vault-relative path suffix).
  const matches = findOnFilesystem(ctx.vaultPath, ref, pathLike);
  if (matches.length === 1) {
    const rel = matches[0]!;
    return {
      vaultRelativePath: rel,
      absolutePath: path.join(ctx.vaultPath, rel),
      slug: path.basename(rel, '.html'),
    };
  }
  if (matches.length > 1) {
    throw mcpError(
      -32602,
      `Ambiguous ref '${ref}': found ${matches.length} files`,
      { candidates: matches }
    );
  }

  throw mcpError(-32602, `Page not found: ${ref}`, undefined);
}

/** Escape SQLite LIKE wildcards (% and _) plus the escape char itself. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Resolve a path-like ref against the pages table.
 * Matches either an exact vault-relative path (ref + '.html') or any page
 * whose path ends with '/<ref>.html'.
 */
function queryPagesByPathSuffix(
  db: { prepare(sql: string): { all(...args: unknown[]): unknown[] } },
  ref: string
): string[] {
  try {
    const stmt = db.prepare(
      `SELECT path FROM pages WHERE path = ? OR path LIKE ? ESCAPE '\\'`
    );
    const rows = stmt.all(`${ref}.html`, `%/${escapeLike(ref)}.html`) as Array<{
      path: string;
    }>;
    return rows.map((r) => r.path);
  } catch {
    return [];
  }
}

/** Query the wikilinks table directly (sync SQLite). */
function queryWikilinks(
  db: { prepare(sql: string): { all(...args: unknown[]): unknown[] } },
  slug: string
): Array<{ path: string; ambiguous: number }> {
  try {
    const stmt = db.prepare('SELECT path, ambiguous FROM wikilinks WHERE slug = ?');
    return stmt.all(slug) as Array<{ path: string; ambiguous: number }>;
  } catch {
    return [];
  }
}

/**
 * Walk the filesystem looking for a matching .html file under vaultPath.
 * For a bare slug, matches files named '<ref>.html'. For a path-like ref,
 * matches files whose vault-relative path equals or ends with '/<ref>.html'.
 */
function findOnFilesystem(vaultPath: string, ref: string, pathLike: boolean): string[] {
  const results: string[] = [];
  walkDir(vaultPath, vaultPath, ref, pathLike, results);
  return results;
}

function walkDir(
  root: string,
  dir: string,
  ref: string,
  pathLike: boolean,
  out: string[]
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(root, full, ref, pathLike, out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      const rel = path.relative(root, full);
      if (pathLike) {
        const relNoExt = rel.slice(0, -'.html'.length);
        if (relNoExt === ref || relNoExt.endsWith(`/${ref}`)) {
          out.push(rel);
        }
      } else if (entry.name === `${ref}.html`) {
        out.push(rel);
      }
    }
  }
}

// ── MCP error helpers ──────────────────────────────────────────────────────

export interface McpErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export function mcpError(code: number, message: string, data: unknown): McpErrorPayload & Error {
  const err = new Error(message) as Error & McpErrorPayload;
  err.code = code;
  err.message = message;
  err.data = data;
  return err;
}

function isMcpError(err: unknown): err is McpErrorPayload {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as McpErrorPayload).code === 'number'
  );
}
