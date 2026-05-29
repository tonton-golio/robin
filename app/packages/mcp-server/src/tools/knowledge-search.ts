/**
 * knowledge.search — Unified search across promoted memory and indexed pages.
 */

import { z } from 'zod/v4';
import { searchMemories } from '@robin/memory';
import type { ToolContext, SearchHit } from '../types.js';

export const KnowledgeSearchInputSchema = z.object({
  query: z.string().min(1).describe('Search query'),
  k: z.number().int().positive().optional().default(10).describe('Results per source'),
  include_memory_status: z
    .array(z.enum(['tentative', 'active', 'superseded', 'rejected', 'archived']))
    .optional()
    .default(['active', 'tentative']),
  page_types: z.array(z.string()).optional().describe('Optional robin:type filter for page hits'),
});

export type KnowledgeSearchInput = z.infer<typeof KnowledgeSearchInputSchema>;

export async function knowledgeSearch(input: KnowledgeSearchInput, ctx: ToolContext) {
  const memoryHits = await searchMemories(ctx.vaultPath, {
    query: input.query,
    k: input.k,
    status: input.include_memory_status,
  });

  let pageHits: SearchHit[] = [];
  let pageMode: 'rrf' | 'fallback' = 'fallback';
  if (ctx.indexer) {
    try {
      pageHits = await ctx.indexer.search(input.query, {
        k: input.k,
        types: input.page_types,
      });
      pageMode = 'rrf';
    } catch {
      pageHits = [];
    }
  }

  return {
    query: input.query,
    memory: {
      mode: 'lexical',
      hits: memoryHits,
    },
    pages: {
      mode: pageMode,
      hits: pageHits,
    },
  };
}
