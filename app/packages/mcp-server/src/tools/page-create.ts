/**
 * page.create — Create a new Robin page.
 *
 * The unique key is the vault-relative path, so creation only fails when a file
 * already exists at the exact target path. Bare-slug collisions elsewhere in the
 * vault are allowed (e.g. every directory has its own `_index`); resolution is
 * path-aware. folder is vault-relative, e.g. 'brain/tasks'.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v4';
import { writePage, assemblePage, mdToBlocks, slugify as libSlugify } from '../html-utils.js';
import { mcpError } from '../resolve.js';
import type { ToolContext, PageCreateOutput } from '../types.js';
import type { RobinBlock } from '@robin/converter';

export const PageCreateInputSchema = z.object({
  folder: z.string().describe('Vault-relative folder, e.g. brain/tasks'),
  slug: z.string().min(1).describe('Kebab-case basename slug (unique within its folder; the path is the global key)'),
  type: z.string().describe('robin:type value'),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  body_md: z.string().optional(),
});

export type PageCreateInput = z.infer<typeof PageCreateInputSchema>;

export async function pageCreate(
  input: PageCreateInput,
  ctx: ToolContext
): Promise<PageCreateOutput> {
  const slug = libSlugify(input.slug) || input.slug;
  const vaultRelativePath = `${input.folder}/${slug}.html`.replace(/\/+/g, '/');

  // Containment guard: `input.folder` is otherwise unvalidated, so a folder like
  // '../.claude' or an absolute path would let creation write outside the vault.
  // Reject null bytes and any path that resolves outside the vault root, mirroring
  // the guard in resolve.ts (page.read/write/move/delete).
  if (input.folder.includes('\0') || slug.includes('\0')) {
    throw mcpError(-32602, `Invalid path: ${vaultRelativePath}`, undefined);
  }
  const absolutePath = path.join(ctx.vaultPath, vaultRelativePath);
  const vaultRoot = path.resolve(ctx.vaultPath);
  const resolvedAbs = path.resolve(absolutePath);
  if (resolvedAbs !== vaultRoot && !resolvedAbs.startsWith(vaultRoot + path.sep)) {
    throw mcpError(-32602, `Path escapes the vault: ${vaultRelativePath}`, undefined);
  }

  // Defense-in-depth: even staying inside the vault root, restrict writes to the
  // knowledge dirs so creation can't land in control-plane/runtime dirs
  // (.claude, .robin, tools). Mirrors the web allowlist in
  // apps/web/lib/vault-file.ts (normalizeVaultFilePath ALLOWED_ROOTS).
  const ALLOWED_ROOTS = new Set(['brain', 'inbox', 'out', 'logs']);
  const folderRoot = vaultRelativePath.split('/')[0];
  if (!folderRoot || !ALLOWED_ROOTS.has(folderRoot)) {
    throw mcpError(
      -32602,
      `Folder must be under brain/, inbox/, out/, or logs/: ${vaultRelativePath}`,
      undefined
    );
  }

  // Path collision: the vault-relative path is the unique key.
  if (fs.existsSync(absolutePath)) {
    throw mcpError(-32602, `Path collision: ${vaultRelativePath} already exists`, {
      candidates: [vaultRelativePath],
    });
  }

  // Determine blocks (v0.2: only body_md is accepted; blocks are an in-memory
  // intermediate produced by the converter).
  let blocks: RobinBlock[] = [];
  if (input.body_md) {
    blocks = mdToBlocks(input.body_md, vaultRelativePath);
  }

  const now = new Date();
  const fm: Record<string, unknown> = {
    ...(input.frontmatter ?? {}),
    type: input.type,
    slug,
    updated: now.toISOString(),
    created: now.toISOString(),
  };

  const html = assemblePage({
    slug,
    vaultRelativePath,
    frontmatter: fm,
    blocks,
    updated: now,
  });

  await writePage(absolutePath, html);

  return { path: vaultRelativePath, slug };
}
