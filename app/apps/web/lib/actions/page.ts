'use server';

/**
 * Server Actions for page mutations.
 *
 * These are the primary mutation path for the React UI (edit + new).
 * The thin /api/page/* routes are kept for now (MCP proxying, potential non-React clients).
 *
 * Core logic is intentionally duplicated in a tiny way for the two entry points
 * because the API routes still need to support the ROBIN_MCP_URL proxy path.
 * When we decide to fully deprecate the thin routes, we can collapse to a single
 * implementation.
 */

import type { RobinBlock } from '@robin/converter';
import { canonicalizeHtml, normalizeFrontmatter } from '@robin/converter';
import { writePage, notifyIndexerWrite } from '@/lib/write-page';
import path from 'path';
import { vaultPath } from '@/lib/vault';
import { normalizeVaultFilePath } from '@/lib/vault-file';
import fs from 'fs/promises';

// ── Save (edit existing page) ────────────────────────────────────────────────

export interface SavePageInput {
  path: string; // vault-relative, e.g. 'brain/foo.html'
  frontmatter: Record<string, unknown>;
  blocks: RobinBlock[];
}

export async function savePage(input: SavePageInput): Promise<{ ok: boolean; error?: string; path?: string; slug?: string }> {
  const { path: filePath, frontmatter, blocks } = input;

  if (!filePath || typeof filePath !== 'string' || !filePath.endsWith('.html')) {
    return { ok: false, error: 'invalid path' };
  }

  // Security: enforce the vault allowlist (brain/inbox/out/logs), reject `..`,
  // absolute paths, and null bytes. A bare `startsWith('..')` check is bypassable
  // (e.g. `brain/../etc/x.html` normalizes to `etc/x.html`).
  const normalized = normalizeVaultFilePath(filePath);
  if (!normalized || !normalized.endsWith('.html')) {
    return { ok: false, error: 'invalid path' };
  }

  // Note: We do NOT proxy to MCP here. The UI always writes directly.
  // The old /api route still supports the ROBIN_MCP_URL proxy for legacy callers.
  const slug = path.basename(normalized, '.html');
  // Single source of truth: derive RobinMeta via the converter's
  // normalizeFrontmatter (correct version '0.2', status/state synonym handling,
  // date/size/tag coercion) instead of hand-building meta here.
  const title = typeof frontmatter['title'] === 'string' ? (frontmatter['title'] as string) : slug;
  const { meta } = normalizeFrontmatter({ frontmatter, slug, outputPath: normalized, title });

  const html = canonicalizeHtml({ meta, frontmatter, blocks });

  try {
    await writePage({ vaultRelativePath: normalized, html });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'write failed' };
  }

  void notifyIndexerWrite(normalized);

  return { ok: true, path: normalized, slug };
}

// ── Create (new page) ────────────────────────────────────────────────────────

export interface CreatePageInput {
  folder: string; // 'brain' | 'out'
  slug: string;   // kebab-case, no .html
  type: string;
  frontmatter: Record<string, unknown>;
  blocks: RobinBlock[];
}

export async function createPage(input: CreatePageInput): Promise<{ ok: boolean; error?: string; path?: string; slug?: string }> {
  const { folder, slug, type, frontmatter, blocks } = input;

  if (!folder || !slug) {
    return { ok: false, error: 'folder and slug are required' };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return { ok: false, error: 'slug must be kebab-case lowercase ASCII' };
  }

  const filePath = `${folder}/${slug}.html`;

  // Enforce the vault allowlist on the assembled path — `folder` is otherwise
  // unvalidated and could escape the vault (e.g. '../.claude').
  const normalized = normalizeVaultFilePath(filePath);
  if (!normalized || !normalized.endsWith('.html')) {
    return { ok: false, error: 'invalid path' };
  }

  const absPath = vaultPath(normalized);
  try {
    await fs.access(absPath);
    return { ok: false, error: 'conflict', path: filePath };
  } catch {
    // does not exist — good
  }

  const now = new Date();

  const enrichedFm = {
    type,
    created: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...frontmatter,
  };

  // Single source of truth: derive RobinMeta via the converter's
  // normalizeFrontmatter (correct version '0.2', status/state synonym handling,
  // date/size/tag coercion) instead of hand-building meta here with version
  // '0.1' and a hand-picked subset of fields.
  const title = typeof frontmatter['title'] === 'string' ? (frontmatter['title'] as string) : slug;
  const { meta } = normalizeFrontmatter({
    frontmatter: enrichedFm,
    slug,
    outputPath: normalized,
    title,
    updated: now,
  });

  const defaultBlocks: RobinBlock[] = blocks.length > 0
    ? blocks
    : [{ kind: 'heading', level: 1, content: [{ kind: 'text', text: slug }] }];

  const html = canonicalizeHtml({ meta, frontmatter: enrichedFm, blocks: defaultBlocks });

  try {
    await writePage({ vaultRelativePath: normalized, html });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'write failed' };
  }

  void notifyIndexerWrite(normalized);

  return { ok: true, path: normalized, slug };
}
