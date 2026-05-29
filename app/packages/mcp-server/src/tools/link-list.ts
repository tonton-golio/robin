/**
 * link.list — List backlinks (or forward links) for a page.
 *
 * Default direction: 'in' (backlinks).
 */

import { z } from 'zod/v4';
import { resolveRef } from '../resolve.js';
import type { ToolContext, LinkListOutput, LinkEntry } from '../types.js';

export const LinkListInputSchema = z.object({
  ref: z.string().min(1).describe('Slug or vault-relative path'),
  direction: z
    .enum(['in', 'out', 'both'])
    .optional()
    .default('in')
    .describe("'in' = backlinks, 'out' = forward links, 'both' = all"),
});

export type LinkListInput = z.infer<typeof LinkListInputSchema>;

export async function linkList(
  input: LinkListInput,
  ctx: ToolContext
): Promise<LinkListOutput> {
  const resolved = await resolveRef(input.ref, ctx);
  const direction = input.direction ?? 'in';
  const links: LinkEntry[] = [];

  if (!ctx.indexer) {
    return { links };
  }

  const db = ctx.indexer.db;

  try {
    if (direction === 'in' || direction === 'both') {
      const stmt = db.prepare(
        `SELECT l.from_slug, l.kind, w.path
         FROM links l
         LEFT JOIN wikilinks w ON w.slug = l.from_slug
         WHERE l.to_slug = ?`
      );
      const rows = stmt.all(resolved.slug) as Array<{
        from_slug: string;
        kind: string;
        path: string | null;
      }>;
      for (const row of rows) {
        links.push({
          slug: row.from_slug,
          path: row.path ?? '',
          kind: row.kind,
        });
      }
    }

    if (direction === 'out' || direction === 'both') {
      const stmt = db.prepare(
        `SELECT l.to_slug, l.kind, w.path
         FROM links l
         LEFT JOIN wikilinks w ON w.slug = l.to_slug
         WHERE l.from_slug = ?`
      );
      const rows = stmt.all(resolved.slug) as Array<{
        to_slug: string;
        kind: string;
        path: string | null;
      }>;
      for (const row of rows) {
        links.push({
          slug: row.to_slug,
          path: row.path ?? '',
          kind: row.kind,
        });
      }
    }
  } catch {
    // indexer error — return empty
  }

  return { links };
}
