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
 * Idempotent: if the source body already links the target — as the bare slug
 * `data-wiki="<to.slug>"` OR a path-like `data-wiki="<dir>/<to.slug>"` anchor —
 * we leave the body untouched and report created=false.
 */

import { z } from 'zod/v4';
import { blocksToBodyHtml } from '@robin/converter';
import { resolveRef, mcpError } from '../resolve.js';
import {
  readPageWithRaw,
  writePage,
  assemblePage,
  extractMeta,
  extractTitle,
  extractUnknownMetaTags,
  mdToBlocks,
} from '../html-utils.js';
import type { ToolContext, LinkAddOutput } from '../types.js';

export const LinkAddInputSchema = z.object({
  from_ref: z.string().min(1).describe('Source slug or path — the page the wikilink is written INTO'),
  to_ref: z.string().min(1).describe('Target slug or path — the page the wikilink points AT'),
  // NOTE: `kind` is NOT durable. The link is persisted as a plain [[slug]]
  // wikilink in the source body (the source of truth), which carries no
  // relation type; the indexer rebuilds the `links` table from those anchors
  // with a hardcoded kind='wikilink' on every scan. A custom `kind` only
  // survives in SQLite until the next index.refresh / web resync, then reverts
  // to 'wikilink'. Kept for back-compat (and immediate-query convenience) but
  // callers must not rely on typed relations surviving a rescan.
  kind: z.string().optional().default('ref').describe("Link kind for the immediate index row only — NON-DURABLE: reverts to 'wikilink' on the next reindex"),
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
  const { parsed, html: originalHtml } = await readPageWithRaw(from.absolutePath);
  const existingBody = parsed.bodyHtml ?? '';
  // Idempotency must catch the target however it is already linked: both as the
  // bare basename slug and as a path-like target ([[features/images]] →
  // data-wiki="features/images"). Match in either direction by basename suffix
  // so a pre-existing path-like link to the same page isn't duplicated.
  const targetPathNoExt = to.vaultRelativePath.replace(/\.html$/, '');
  const alreadyLinked = parsed.wikilinkTargets.some(
    (t) =>
      t === to.slug ||
      t === targetPathNoExt ||
      targetPathNoExt.endsWith(`/${t}`) ||
      t.endsWith(`/${to.slug}`)
  );

  let created = false;
  if (!alreadyLinked) {
    const meta = extractMeta(parsed, from.vaultRelativePath);
    const originalTitle = extractTitle(originalHtml);
    const extraMeta = extractUnknownMetaTags(parsed);

    const hasRelated = /<h2[^>]*>\s*Related\s*<\/h2>/i.test(existingBody);
    // Render through the converter's block pipeline so the appended wikilink
    // anchor (data-wiki + /p/<slug> href) is byte-identical to any other
    // wikilink the converter emits — and is picked up by the indexer's
    // data-wiki scan on the next rescan.
    const liHtml = blocksToBodyHtml(
      mdToBlocks(`- [[${to.slug}]]`, from.vaultRelativePath)
    );

    let newBody: string;
    const trimmedBody = existingBody.trim();
    // If a ## Related list already exists and ends the body, fold the new
    // bullet into that <ul> rather than appending a second standalone list
    // under the same heading.
    const trailingUl = /<ul\b[^>]*>[\s\S]*<\/ul>\s*$/i.test(trimmedBody);
    const newLi = /<li\b[\s\S]*<\/li>/i.exec(liHtml)?.[0];
    if (hasRelated && trailingUl && newLi) {
      // Insert the rendered <li> just before the final </ul>.
      const lastUlClose = trimmedBody.lastIndexOf('</ul>');
      newBody = `${trimmedBody.slice(0, lastUlClose)}${newLi}${trimmedBody.slice(lastUlClose)}`;
    } else {
      const snippetHtml = hasRelated
        ? liHtml
        : blocksToBodyHtml(
            mdToBlocks(`## Related\n\n- [[${to.slug}]]`, from.vaultRelativePath)
          );
      newBody = trimmedBody.length > 0
        ? `${trimmedBody}\n${snippetHtml.trim()}`
        : snippetHtml.trim();
    }

    const now = new Date();
    const html = assemblePage({
      slug: meta.slug,
      vaultRelativePath: from.vaultRelativePath,
      frontmatter: rawFromMeta(meta),
      bodyHtml: newBody,
      updated: now,
      title: originalTitle || undefined,
      extraMeta,
    });
    await writePage(from.absolutePath, html);
    created = true;
  }

  // ── Index upsert (immediate queryability; rebuilt on next scan anyway) ──────
  if (ctx.indexer) {
    try {
      const db = ctx.indexer.db;
      // Key by from_path (unique) — keying by the non-unique from_slug would
      // share this row with every same-slug hub page.
      const existStmt = db.prepare(
        'SELECT 1 FROM links WHERE from_path = ? AND to_slug = ? AND kind = ?'
      );
      const existing = existStmt.get(from.vaultRelativePath, to.slug, kind);
      if (!existing) {
        const insertStmt = db.prepare(
          'INSERT OR IGNORE INTO links (from_path, from_slug, to_slug, kind) VALUES (?, ?, ?, ?)'
        );
        insertStmt.run(from.vaultRelativePath, from.slug, to.slug, kind);
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
