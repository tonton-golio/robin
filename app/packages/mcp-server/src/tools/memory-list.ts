/**
 * memory.list — List projected Robin memories with filters.
 */

import { z } from 'zod/v4';
import { listMemories } from '@robin/memory';
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

export const MemoryListInputSchema = z.object({
  status: z.array(MemoryStatusSchema).optional().default(['active', 'tentative']),
  type: z.array(MemoryTypeSchema).optional(),
  tier: z.array(MemoryTierSchema).optional(),
  scope: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type MemoryListInput = z.infer<typeof MemoryListInputSchema>;

export async function memoryList(input: MemoryListInput, ctx: ToolContext) {
  const memories = await listMemories(ctx.vaultPath, input);
  return { memories, source: 'brain/memory/events.jsonl' };
}
