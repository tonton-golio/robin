/**
 * page.move — Rename/move a page on disk.
 *
 * Index-only operation: renames the file; does NOT rewrite incoming wikilinks.
 * (Wikilinks resolve via slug in the index; renames are transparent to readers.)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod/v4';
import { resolveRef, mcpError } from '../resolve.js';
import type { ToolContext, PageMoveOutput } from '../types.js';

export const PageMoveInputSchema = z.object({
  from_ref: z.string().min(1).describe('Slug or vault-relative path of the page to move'),
  to_path: z.string().min(1).describe('Vault-relative destination path (must end in .html)'),
});

export type PageMoveInput = z.infer<typeof PageMoveInputSchema>;

const ALLOWED_ROOTS = new Set(['brain', 'inbox', 'out', 'logs']);

/**
 * Validate a destination path stays inside the vault and under an allowed root.
 * Without this, `to_path` like `../../etc/cron.d/x.html` would let page.move
 * write/rename outside the vault.
 */
function safeDestination(vaultPath: string, toPath: string): string {
  if (toPath.includes('\0')) throw mcpError(-32602, 'Invalid destination path', undefined);
  const rel = toPath.endsWith('.html') ? toPath : `${toPath}.html`;
  const normalized = path.posix.normalize(rel.replaceAll(path.sep, '/')).replace(/^\.\//, '');
  const root = normalized.split('/')[0];
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    !root ||
    !ALLOWED_ROOTS.has(root)
  ) {
    throw mcpError(-32602, `Destination must be a vault-relative .html path under ${[...ALLOWED_ROOTS].join('/')}`, { to_path: toPath });
  }
  // Defense in depth: ensure the resolved absolute path is still inside the vault.
  const abs = path.resolve(vaultPath, normalized);
  const root_abs = path.resolve(vaultPath);
  if (abs !== root_abs && !abs.startsWith(root_abs + path.sep)) {
    throw mcpError(-32602, 'Destination escapes the vault', { to_path: toPath });
  }
  return normalized;
}

export async function pageMove(
  input: PageMoveInput,
  ctx: ToolContext
): Promise<PageMoveOutput> {
  const resolved = await resolveRef(input.from_ref, ctx);

  const newRelPath = safeDestination(ctx.vaultPath, input.to_path);

  const newAbsPath = path.join(ctx.vaultPath, newRelPath);

  // Collision guard: fs.rename atomically replaces an existing destination
  // file, so without this a move onto an occupied path silently destroys the
  // page already there (no archive, no recovery). Mirror page.create's
  // collision behavior (-32602 + candidates), while still allowing a no-op /
  // case-only self-move where source and destination resolve to the same file.
  if (newAbsPath !== resolved.absolutePath) {
    const destExists = await fs.access(newAbsPath).then(() => true, () => false);
    if (destExists) {
      throw mcpError(-32602, `Destination already exists: ${newRelPath}`, {
        candidates: [newRelPath],
      });
    }
  }

  // Create destination directory if needed
  await fs.mkdir(path.dirname(newAbsPath), { recursive: true });

  // Rename
  await fs.rename(resolved.absolutePath, newAbsPath);

  return {
    old_path: resolved.vaultRelativePath,
    new_path: newRelPath,
    refs_updated: 0,
  };
}
