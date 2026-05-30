/**
 * memory.save — Save a durable memory with provenance.
 */

import { z } from 'zod/v4';
import { saveMemory } from '@robin/memory';
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
const MemoryConfidenceSchema = z.enum(['low', 'medium', 'high']);
const MemoryTierSchema = z.enum(['working', 'episodic', 'semantic', 'procedural']);

const MemorySourceSchema = z.object({
  kind: z.enum(['annotation', 'conversation', 'meeting', 'manual', 'tool', 'repo', 'other']),
  ref: z.string().min(1),
  quote: z.string().optional(),
  captured_at: z.string().optional(),
});

export const MemorySaveInputSchema = z.object({
  type: MemoryTypeSchema,
  tier: MemoryTierSchema.optional().describe('Agentmemory-style tier: working, episodic, semantic, or procedural'),
  scope: z.string().optional().describe("Scope such as 'global', 'project:website', 'repo:my-repo', or a page path"),
  subject: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
  links: z.array(z.string()).optional(),
  source: MemorySourceSchema,
  status: MemoryStatusSchema.optional().default('tentative'),
  confidence: MemoryConfidenceSchema.optional().default('medium'),
  supersedes: z.array(z.string()).optional(),
  merge: z.boolean().optional().default(true).describe('When true, exact duplicate memories increment seen_count instead of creating a duplicate'),
});

export type MemorySaveInput = z.infer<typeof MemorySaveInputSchema>;

export async function memorySave(input: MemorySaveInput, ctx: ToolContext) {
  const memory = await saveMemory(ctx.vaultPath, input);
  return { memory };
}
