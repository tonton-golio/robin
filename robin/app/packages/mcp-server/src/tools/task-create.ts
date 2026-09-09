/**
 * task.create — Create a task page and log to the changelog.
 *
 * Composes page.create + log.append.
 * Slug is derived from the title via slugify().
 */

import { z } from 'zod/v4';
import { normalizeTaskPatch, applyTaskPatch } from '@robin/converter';
import { pageCreate } from './page-create.js';
import { appendLog, slugify } from '../html-utils.js';
import type { ToolContext, TaskCreateOutput } from '../types.js';

export const TaskCreateInputSchema = z.object({
  title: z.string().min(1).describe('Task title'),
  summary: z.string().optional().describe('One-line summary'),
  priority: z.string().optional().describe('Priority: p0 | p1 | p2 | p3'),
  due: z.string().optional().describe('Due date / deadline (ISO-8601)'),
  start: z.string().optional().describe('Planned start date (ISO-8601) — timeline bar origin'),
  end: z.string().optional().describe('Planned end date (ISO-8601) — timeline bar terminus'),
  owner: z.string().optional().describe('Task owner'),
  project: z.string().optional().describe('Canonical project reference'),
  category: z.string().optional(),
  next_action: z.string().optional().describe('Concrete next action, not an inferred commitment'),
  acceptance: z.string().optional().describe('Evidence required for completion'),
  kind: z.string().optional(),
  parent: z.string().optional(),
  body_md: z.string().optional().describe('Optional markdown body'),
  tags: z.array(z.string()).optional().describe('Tags'),
});

export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;

export async function taskCreate(
  input: TaskCreateInput,
  ctx: ToolContext
): Promise<TaskCreateOutput> {
  const slug = slugify(input.title);

  // Canonical task lifecycle key is `status` (the on-disk vault convention; see
  // meta.ts / 49 task pages). New tasks open in the `open` status — the most
  // common initial status across the vault's task pages. Never write `state:`.
  const frontmatter = applyTaskPatch({ title: input.title, type: 'task', status: 'open' }, normalizeTaskPatch({ ...input, status: 'open' }));
  if (input.summary) frontmatter.summary = input.summary;
  if (input.tags?.length) frontmatter.tags = input.tags;

  const result = await pageCreate(
    {
      folder: 'brain/tasks',
      slug,
      type: 'task',
      frontmatter,
      body_md: input.body_md,
    },
    ctx
  );

  // Changelog entry in the canonical Robin convention (matches the create-task
  // skill): a single dated header line that links the new task by slug.
  //   ## [YYYY-MM-DD] task | Created [[<slug>]] — <summary>
  const dateStr = new Date().toISOString().slice(0, 10);
  const logEntry = `## [${dateStr}] task | Created [[${result.slug}]]${input.summary ? ` — ${input.summary}` : ''}`;

  await appendLog(ctx.vaultPath, 'changelog', logEntry);

  return {
    path: result.path,
    slug: result.slug,
    log_entry: logEntry,
  };
}
