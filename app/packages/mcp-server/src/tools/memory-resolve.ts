/**
 * memory.resolve — Mark an existing memory active, superseded, rejected, or archived.
 */

import { z } from 'zod/v4';
import { resolveMemory } from '@robin/memory';
import type { ToolContext } from '../types.js';

export const MemoryResolveInputSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['tentative', 'active', 'superseded', 'rejected', 'archived']),
  resolution: z.string().min(1),
  superseded_by: z.string().optional(),
});

export type MemoryResolveInput = z.infer<typeof MemoryResolveInputSchema>;

export async function memoryResolve(input: MemoryResolveInput, ctx: ToolContext) {
  const memory = await resolveMemory(ctx.vaultPath, input);
  return { memory };
}
