/**
 * page.write_many — Batch page writes (critical for ingest-meeting).
 *
 * Runs writes sequentially to avoid race conditions on shared files.
 * Each write is independent; errors are collected per-item, not thrown.
 */

import { z } from 'zod/v4';
import { pageWrite } from './page-write.js';
import type { ToolContext, PageWriteManyOutput, WriteResult } from '../types.js';

const WriteOpSchema = z.object({
  ref: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  body_md: z.string().optional(),
});

export const PageWriteManyInputSchema = z.object({
  writes: z.array(WriteOpSchema).min(1).describe('Array of write operations'),
});

export type PageWriteManyInput = z.infer<typeof PageWriteManyInputSchema>;

export async function pageWriteMany(
  input: PageWriteManyInput,
  ctx: ToolContext
): Promise<PageWriteManyOutput> {
  const results: WriteResult[] = [];

  for (const op of input.writes) {
    try {
      const out = await pageWrite(op as Parameters<typeof pageWrite>[0], ctx);
      results.push({ path: out.path, slug: out.slug, status: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ path: op.ref, slug: '', status: 'error', error: msg });
    }
  }

  return { results };
}
