/**
 * page.write — Update an existing Robin page (frontmatter and/or body).
 *
 * Accepts body_md only (v0.2). Blocks are an in-memory intermediate produced
 * by the converter and are never accepted from clients.
 * Frontmatter is merged into existing (partial update).
 * To clear a field, pass null.
 */

import { z } from "zod/v4";
import { frontmatterFromMeta } from "@robin/converter";
import { hashHtml } from "@robin/vault-io";
import { mcpError, resolveRef } from "../resolve.js";
import {
  readPageWithRaw,
  extractMeta,
  extractTitle,
  extractUnknownMetaTags,
  writePage,
  mergeFrontmatter,
  assemblePage,
  mdToBlocks,
} from "../html-utils.js";
import type { ToolContext, PageWriteOutput } from "../types.js";

export const PageWriteInputSchema = z.object({
  ref: z.string().min(1).describe("Slug or vault-relative path"),
  frontmatter: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Partial frontmatter update; pass null value to clear a field"),
  body_md: z.string().optional().describe("Markdown body to convert and store"),
  expected_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional()
    .describe("SHA-256 from page.read; reject the write if the page changed"),
});

export type PageWriteInput = z.infer<typeof PageWriteInputSchema>;

export async function pageWrite(input: PageWriteInput, ctx: ToolContext): Promise<PageWriteOutput> {
  const resolved = await resolveRef(input.ref, ctx);
  const { parsed, html: originalHtml } = await readPageWithRaw(resolved.absolutePath);
  const existingMeta = extractMeta(parsed, resolved.vaultRelativePath);
  const title = extractTitle(originalHtml);
  const extraMeta = extractUnknownMetaTags(parsed);

  // Merge frontmatter (v0.2: frontmatter no longer round-trips through a JSON
  // script tag, so we synthesize a minimal raw from the meta we just parsed
  // out of <head> when no inline frontmatter survives).
  const existingRaw =
    (parsed.frontmatter as Record<string, unknown> | null) ?? frontmatterFromMeta(existingMeta);
  if (
    input.frontmatter?.["id"] !== undefined &&
    input.frontmatter["id"] !== existingMeta.id
  ) {
    throw mcpError(-32602, "immutable robin:id cannot be changed through page.write", undefined);
  }
  const mergedRaw = input.frontmatter
    ? mergeFrontmatter(existingRaw, input.frontmatter)
    : existingRaw;
  const updatedRaw: Record<string, unknown> = {
    ...mergedRaw,
    version: existingMeta.version,
    ...(existingMeta.id ? { id: existingMeta.id } : {}),
  };
  if (!existingMeta.id) delete updatedRaw["id"];

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
      title,
      extraMeta,
    });
  } else if (
    parsed.blocks &&
    Array.isArray(parsed.blocks) &&
    (parsed.blocks as unknown[]).length > 0
  ) {
    // Legacy v0.1 path: blocks JSON still embedded.
    html = assemblePage({
      slug: existingMeta.slug,
      vaultRelativePath: resolved.vaultRelativePath,
      frontmatter: { ...updatedRaw, updated: now.toISOString() },
      blocks: parsed.blocks as import("@robin/converter").RobinBlock[],
      updated: now,
      title,
      extraMeta,
    });
  } else {
    // v0.2 path with no new body — keep the existing <article> body verbatim.
    html = assemblePage({
      slug: existingMeta.slug,
      vaultRelativePath: resolved.vaultRelativePath,
      frontmatter: { ...updatedRaw, updated: now.toISOString() },
      bodyHtml: parsed.bodyHtml,
      updated: now,
      title,
      extraMeta,
    });
  }

  await writePage(resolved.absolutePath, html, {
    // Even when the caller did not supply a precondition, protect this
    // read-modify-write window from a concurrent writer.
    expectedHash: input.expected_hash ?? hashHtml(originalHtml),
  });

  return {
    path: resolved.vaultRelativePath,
    slug: resolved.slug,
    updated: now.toISOString(),
  };
}
