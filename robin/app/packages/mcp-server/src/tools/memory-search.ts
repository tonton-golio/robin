/**
 * memory.search — Search projected Robin memories.
 */

import { z } from 'zod/v4';
import { searchMemories } from '@robin/memory';
import type { ToolContext } from '../types.js';

const MemoryTypeSchema = z.enum([
  'preference',
  'correction',
  'decision',
  'pattern',
  'procedure',
  'project',
  'person',
  'repo',
  'task',
  'other',
]);

const MemoryStatusSchema = z.enum(['tentative', 'active', 'superseded', 'rejected', 'archived']);
const MemoryTierSchema = z.enum(['working', 'episodic', 'semantic', 'procedural']);

export const MemorySearchInputSchema = z.object({
  query: z.string().optional().describe('Keyword query. Empty query lists recent memories.'),
  k: z.number().int().positive().optional().default(20),
  status: z.array(MemoryStatusSchema).optional().default(['active', 'tentative']),
  type: z.array(MemoryTypeSchema).optional(),
  tier: z.array(MemoryTierSchema).optional(),
  scope: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type MemorySearchInput = z.infer<typeof MemorySearchInputSchema>;

export async function memorySearch(input: MemorySearchInput, ctx: ToolContext) {
  const hits = await searchMemories(ctx.vaultPath, input);
  return { hits, mode: 'lexical', source: 'brain/memory/events.jsonl' };
}
