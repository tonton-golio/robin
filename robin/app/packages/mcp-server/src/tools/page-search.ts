/**
 * page.search — Full-text search via the indexer.
 *
 * Falls back to mode='fallback' with empty hits if indexer is unavailable.
 */

import { z } from 'zod/v4';
import type { ToolContext, PageSearchOutput } from '../types.js';

export const PageSearchInputSchema = z.object({
  query: z.string().min(1).describe('Search query'),
  k: z.number().int().positive().optional().default(20).describe('Max results'),
  types: z.array(z.string()).optional().describe('Filter by robin:type values'),
  tiers: z.array(z.string()).optional().describe('Filter by tier values'),
  since: z.string().optional().describe('Filter by updated >= ISO-8601 date'),
});

export type PageSearchInput = z.infer<typeof PageSearchInputSchema>;

export async function pageSearch(
  input: PageSearchInput,
  ctx: ToolContext
): Promise<PageSearchOutput> {
  if (!ctx.indexer) {
    return { hits: [], mode: 'fallback' };
  }

  try {
    const hits = await ctx.indexer.search(input.query, {
      k: input.k ?? 20,
      types: input.types,
      tiers: input.tiers,
      since: input.since,
    });
    return { hits, mode: 'rrf' };
  } catch {
    return { hits: [], mode: 'fallback' };
  }
}
