/**
 * page.read — Read a Robin page by slug or path.
 */

import { z } from 'zod/v4';
import { resolveRef } from '../resolve.js';
import { readPage, extractMeta } from '../html-utils.js';
import type { ToolContext, PageReadOutput, LinkEntry } from '../types.js';

export const PageReadInputSchema = z.object({
  ref: z.string().min(1).describe('Slug or vault-relative path (ending in .html)'),
});

export type PageReadInput = z.infer<typeof PageReadInputSchema>;

export async function pageRead(
  input: PageReadInput,
  ctx: ToolContext
): Promise<PageReadOutput> {
  const resolved = await resolveRef(input.ref, ctx);
  const parsed = await readPage(resolved.absolutePath);
  const meta = extractMeta(parsed, resolved.vaultRelativePath);

  // Build links_out from wikilinkTargets
  const linksOut: LinkEntry[] = parsed.wikilinkTargets.map((slug) => ({
    slug,
    path: '',
    kind: 'wikilink',
  }));

  // Build links_in from indexer if available
  const linksIn: LinkEntry[] = [];
  if (ctx.indexer) {
    try {
      const db = ctx.indexer.db;
      const stmt = db.prepare(
        'SELECT from_slug, kind FROM links WHERE to_slug = ?'
      );
      const rows = stmt.all(resolved.slug) as Array<{ from_slug: string; kind: string }>;
      for (const row of rows) {
        // Try to resolve from_slug to a path
        const pathStmt = db.prepare('SELECT path FROM wikilinks WHERE slug = ?');
        const pathRow = pathStmt.get(row.from_slug) as { path: string } | undefined;
        linksIn.push({
          slug: row.from_slug,
          path: pathRow?.path ?? '',
          kind: row.kind,
        });
      }
    } catch {
      // ignore indexer errors
    }
  }

  return {
    path: resolved.vaultRelativePath,
    slug: resolved.slug,
    meta,
    frontmatter: parsed.frontmatter,
    blocks: parsed.blocks,
    body_html: parsed.bodyHtml,
    links_out: linksOut,
    links_in: linksIn,
  };
}
