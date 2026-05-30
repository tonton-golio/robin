/**
 * page.delete — Delete or archive a Robin page.
 *
 * archive=true (default): moves to nearest sibling 'archive/' folder.
 * archive=false: deletes permanently.
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v4';
import { resolveRef } from '../resolve.js';
import type { ToolContext, PageDeleteOutput } from '../types.js';

export const PageDeleteInputSchema = z.object({
  ref: z.string().min(1).describe('Slug or vault-relative path'),
  archive: z.boolean().optional().default(true).describe('Move to archive/ instead of deleting'),
});

export type PageDeleteInput = z.infer<typeof PageDeleteInputSchema>;

export async function pageDelete(
  input: PageDeleteInput,
  ctx: ToolContext
): Promise<PageDeleteOutput> {
  const resolved = await resolveRef(input.ref, ctx);

  const archive = input.archive ?? true;

  if (!archive) {
    await fs.unlink(resolved.absolutePath);
    return { path: resolved.vaultRelativePath };
  }

  // Move to nearest sibling archive/ dir
  const dir = path.dirname(resolved.absolutePath);
  const archiveDir = path.join(dir, 'archive');
  await fs.mkdir(archiveDir, { recursive: true });

  const filename = path.basename(resolved.absolutePath);
  // Disambiguate against an already-archived file of the same basename:
  // fs.rename silently overwrites, so a recreate-then-re-archive sequence would
  // destroy the earlier archived snapshot. Append a counter (foo.html →
  // foo.1.html) until the target is free, keeping the safety net non-destructive.
  const parsedName = path.parse(filename);
  let archivedAbs = path.join(archiveDir, filename);
  let n = 1;
  while (fsSync.existsSync(archivedAbs)) {
    archivedAbs = path.join(archiveDir, `${parsedName.name}.${n++}${parsedName.ext}`);
  }
  await fs.rename(resolved.absolutePath, archivedAbs);

  const archivedRel = path.relative(ctx.vaultPath, archivedAbs);

  return {
    path: resolved.vaultRelativePath,
    archived_to: archivedRel,
  };
}
