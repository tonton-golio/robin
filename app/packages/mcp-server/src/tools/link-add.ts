/**
 * link.add — Add a DURABLE wikilink from one page to another.
 *
 * Durability decision (2026-05-29): the link must survive a reindex. The
 * indexer rebuilds its `links` table from each page's `data-wiki` anchors on
 * every scan, so a row inserted only into SQLite is wiped on the next rescan
 * (and the web /api/resync path or the MCP server's startup scan does exactly
 * that). The fix: write a real `[[to_ref]]` wikilink into the SOURCE page's
 * body, under a `## Related` section, so the link is part of the document and
 * is re-derived by every reader (web app, indexer, MCP).
 *
 * We still upsert the SQLite `links` row when an indexer is attached so the
 * link is queryable immediately (before the next scan), but the body write is
 * the source of truth.
 *
 * Idempotent: if the source body already contains a `data-wiki="<to.slug>"`
 * anchor, we leave the body untouched and report created=false.
 */

import { z } from 'zod/v4';
import { blocksToBodyHtml } from '@robin/converter';
import { resolveRef, mcpError } from '../resolve.js';
import { readPage, writePage, assemblePage, extractMeta, mdToBlocks } from '../html-utils.js';
import type { ToolContext, LinkAddOutput } from '../types.js';

export const LinkAddInputSchema = z.object({
  from_ref: z.string().min(1).describe('Source slug or path — the page the wikilink is written INTO'),
  to_ref: z.string().min(1).describe('Target slug or path — the page the wikilink points AT'),
  kind: z.string().optional().default('ref').describe("Link kind (default 'ref'); also used as the relation column in the index"),
});

export type LinkAddInput = z.infer<typeof LinkAddInputSchema>;

export async function linkAdd(
  input: LinkAddInput,
  ctx: ToolContext
): Promise<LinkAddOutput> {
  const from = await resolveRef(input.from_ref, ctx);
  const to = await resolveRef(input.to_ref, ctx);
  const kind = input.kind ?? 'ref';

  if (from.slug === to.slug && from.vaultRelativePath === to.vaultRelativePath) {
    throw mcpError(-32602, `Refusing to add a self-link on ${from.vaultRelativePath}`, undefined);
  }

  // ── Durable body write ─────────────────────────────────────────────────────
  // Read the source page and check whether it already links to the target.
  const parsed = await readPage(from.absolutePath);
  const existingBody = parsed.bodyHtml ?? '';
  const alreadyLinked = parsed.wikilinkTargets.includes(to.slug);

  let created = false;
  if (!alreadyLinked) {
    const meta = extractMeta(parsed, from.vaultRelativePath);

    const hasRelated = /<h2[^>]*>\s*Related\s*<\/h2>/i.test(existingBody);
    const snippetMd = hasRelated
      ? `- [[${to.slug}]]`
      : `## Related\n\n- [[${to.slug}]]`;
    // Render through the converter's block pipeline so the appended wikilink
    // anchor (data-wiki + /p/<slug> href) is byte-identical to any other
    // wikilink the converter emits — and is picked up by the indexer's
    // data-wiki scan on the next rescan.
    const snippetHtml = blocksToBodyHtml(
      mdToBlocks(snippetMd, from.vaultRelativePath)
    );

    const newBody = existingBody.trim().length > 0
      ? `${existingBody.trim()}\n${snippetHtml.trim()}`
      : snippetHtml.trim();

    const now = new Date();
    const html = assemblePage({
      slug: meta.slug,
      vaultRelativePath: from.vaultRelativePath,
      frontmatter: rawFromMeta(meta),
      bodyHtml: newBody,
      updated: now,
    });
    await writePage(from.absolutePath, html);
    created = true;
  }

  // ── Index upsert (immediate queryability; rebuilt on next scan anyway) ──────
  if (ctx.indexer) {
    try {
      const db = ctx.indexer.db;
      const existStmt = db.prepare(
        'SELECT 1 FROM links WHERE from_slug = ? AND to_slug = ? AND kind = ?'
      );
      const existing = existStmt.get(from.slug, to.slug, kind);
      if (!existing) {
        const insertStmt = db.prepare(
          'INSERT OR IGNORE INTO links (from_slug, to_slug, kind) VALUES (?, ?, ?)'
        );
        insertStmt.run(from.slug, to.slug, kind);
      }
    } catch {
      // indexer unavailable / schema mismatch — the body write is the durable
      // source of truth, so this is best-effort only.
    }
  }

  return {
    from_slug: from.slug,
    to_slug: to.slug,
    kind,
    created,
  };
}

/** Reconstruct a minimal frontmatter dict from RobinMeta for re-assembly. */
function rawFromMeta(meta: import('@robin/converter').RobinMeta): Record<string, unknown> {
  const raw: Record<string, unknown> = { type: meta.type };
  if (meta.summary) raw.summary = meta.summary;
  // Carry lifecycle under the canonical `status` key, folding a legacy `state`
  // value in so a status-less / state-only page converges on rewrite.
  const status = meta.status ?? meta.state;
  if (status) raw.status = status;
  if (meta.owner) raw.owner = meta.owner;
  if (meta.priority) raw.priority = meta.priority;
  if (meta.size !== undefined) raw.size = meta.size;
  if (meta.due) raw.due = meta.due;
  if (meta.role) raw.role = meta.role;
  if (meta.relationship) raw.relationship = meta.relationship;
  if (meta.started) raw.started = meta.started;
  if (meta.date) raw.date = meta.date;
  if (meta.duration) raw.duration = meta.duration;
  if (meta.tier) raw.tier = meta.tier;
  if (meta.created) raw.created = meta.created;
  if (meta.tags.length) raw.tags = [...meta.tags];
  if (meta.attendees.length) raw.attendees = [...meta.attendees];
  if (meta.sources.length) raw.sources = [...meta.sources];
  return raw;
}
