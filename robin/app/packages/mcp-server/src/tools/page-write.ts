/**
 * page.write — Update an existing Robin page (frontmatter and/or body).
 *
 * Accepts body_md only (v0.2). Blocks are an in-memory intermediate produced
 * by the converter and are never accepted from clients.
 * Frontmatter is merged into existing (partial update).
 * To clear a field, pass null.
 */

import { z } from 'zod/v4';
import { resolveRef } from '../resolve.js';
import { readPage, extractMeta, writePage, mergeFrontmatter, assemblePage, mdToBlocks } from '../html-utils.js';
import type { ToolContext, PageWriteOutput } from '../types.js';

export const PageWriteInputSchema = z.object({
  ref: z.string().min(1).describe('Slug or vault-relative path'),
  frontmatter: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Partial frontmatter update; pass null value to clear a field'),
  body_md: z.string().optional().describe('Markdown body to convert and store'),
});

export type PageWriteInput = z.infer<typeof PageWriteInputSchema>;

export async function pageWrite(
  input: PageWriteInput,
  ctx: ToolContext
): Promise<PageWriteOutput> {
  const resolved = await resolveRef(input.ref, ctx);
  const parsed = await readPage(resolved.absolutePath);
  const existingMeta = extractMeta(parsed, resolved.vaultRelativePath);

  // Merge frontmatter (v0.2: frontmatter no longer round-trips through a JSON
  // script tag, so we synthesize a minimal raw from the meta we just parsed
  // out of <head> when no inline frontmatter survives).
  const existingRaw =
    (parsed.frontmatter as Record<string, unknown> | null) ??
    rawFromMeta(existingMeta);
  const updatedRaw = input.frontmatter
    ? mergeFrontmatter(existingRaw, input.frontmatter)
    : existingRaw;

  // Determine body source:
  //   - If body_md given → convert to blocks (canonical re-render).
  //   - Else if legacy v0.1 page → re-render from the parsed blocks payload.
  //   - Else (v0.2 page with no body_md) → preserve the existing <article>
  //     body HTML verbatim, since the blocks payload is gone.
  const now = new Date();
  let html: string;
  if (input.body_md !== undefined) {
    const blocks = mdToBlocks(input.body_md, resolved.vaultRelativePath);
    html = assemblePage({
      slug: existingMeta.slug,
      vaultRelativePath: resolved.vaultRelativePath,
      frontmatter: { ...updatedRaw, updated: now.toISOString() },
      blocks,
      updated: now,
    });
  } else if (parsed.blocks && Array.isArray(parsed.blocks) && (parsed.blocks as unknown[]).length > 0) {
    // Legacy v0.1 path: blocks JSON still embedded.
    html = assemblePage({
      slug: existingMeta.slug,
      vaultRelativePath: resolved.vaultRelativePath,
      frontmatter: { ...updatedRaw, updated: now.toISOString() },
      blocks: parsed.blocks as import('@robin/converter').RobinBlock[],
      updated: now,
    });
  } else {
    // v0.2 path with no new body — keep the existing <article> body verbatim.
    html = assemblePage({
      slug: existingMeta.slug,
      vaultRelativePath: resolved.vaultRelativePath,
      frontmatter: { ...updatedRaw, updated: now.toISOString() },
      bodyHtml: parsed.bodyHtml,
      updated: now,
    });
  }

  await writePage(resolved.absolutePath, html);

  return {
    path: resolved.vaultRelativePath,
    slug: resolved.slug,
    updated: now.toISOString(),
  };
}

/**
 * Synthesize a minimal frontmatter dict from RobinMeta. Used when reading a
 * v0.2 page that no longer carries an embedded JSON frontmatter payload — the
 * <head> meta tags become the authoritative source.
 */
function rawFromMeta(meta: import('@robin/converter').RobinMeta): Record<string, unknown> {
  const raw: Record<string, unknown> = { type: meta.type };
  if (meta.summary) raw.summary = meta.summary;
  if (meta.state) raw.state = meta.state;
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
