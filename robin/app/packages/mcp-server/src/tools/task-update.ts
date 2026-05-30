/**
 * task.update — Update a task's lifecycle status (and optionally priority,
 * owner, due) on an existing page, writing the CANONICAL `robin:status` and a
 * changelog line.
 *
 * This is the most-needed missing write tool: task.create stamps the initial
 * status, but until now there was no first-class way to move a task to
 * in-progress / done / blocked etc. — callers had to hand-merge frontmatter
 * via page.write and remember the canonical key (status, never state) plus the
 * changelog convention. task.update encodes both.
 *
 * Frontmatter is merged (existing fields preserved); only the provided fields
 * change. `status` is written under the canonical `status` key, and any legacy
 * `state` key on the page is cleared so the page converges to the convention.
 */

import { z } from 'zod/v4';
import { resolveRef, mcpError } from '../resolve.js';
import {
  readPageWithRaw,
  extractMeta,
  extractTitle,
  extractUnknownMetaTags,
  writePage,
  mergeFrontmatter,
  assemblePage,
  appendLog,
} from '../html-utils.js';
import type { ToolContext } from '../types.js';

export const TaskUpdateInputSchema = z.object({
  ref: z.string().min(1).describe('Task slug or vault-relative path'),
  status: z
    .string()
    .optional()
    .describe('New lifecycle status, e.g. open | in-progress | done | blocked (canonical robin:status)'),
  priority: z.string().optional().describe('New priority: p0 | p1 | p2 | p3'),
  owner: z.string().optional().describe('New owner'),
  due: z.string().optional().describe('New due date (ISO-8601), or empty string to clear'),
  note: z.string().optional().describe('Optional changelog note appended after the status change'),
});

export type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>;

export interface TaskUpdateOutput {
  path: string;
  slug: string;
  status?: string;
  updated: string;
  log_entry: string;
}

export async function taskUpdate(
  input: TaskUpdateInput,
  ctx: ToolContext
): Promise<TaskUpdateOutput> {
  if (
    input.status === undefined &&
    input.priority === undefined &&
    input.owner === undefined &&
    input.due === undefined
  ) {
    throw mcpError(
      -32602,
      'task.update requires at least one of: status, priority, owner, due',
      undefined
    );
  }

  const resolved = await resolveRef(input.ref, ctx);
  const { parsed, html: originalHtml } = await readPageWithRaw(resolved.absolutePath);
  const meta = extractMeta(parsed, resolved.vaultRelativePath);
  // Preserve metadata the lossy RobinMeta round-trip would drop: the human
  // <title> (no RobinMeta field) and any non-vocabulary robin:* tag
  // (robin:workflow, robin:category, …).
  const originalTitle = extractTitle(originalHtml);
  const extraMeta = extractUnknownMetaTags(parsed);

  // Reconstruct the existing frontmatter from meta (v0.2 pages carry no inline
  // frontmatter JSON; <head> meta tags are authoritative).
  const existingRaw =
    (parsed.frontmatter as Record<string, unknown> | null) ?? rawFromMeta(meta);

  // Build the canonical update. status is always written under `status`; clear
  // any legacy `state` so the page converges to the convention on save.
  const updates: Record<string, unknown> = {};
  if (input.status !== undefined) {
    updates['status'] = input.status;
    updates['state'] = null; // clear legacy key
  }
  if (input.priority !== undefined) updates['priority'] = input.priority;
  if (input.owner !== undefined) updates['owner'] = input.owner;
  if (input.due !== undefined) updates['due'] = input.due === '' ? null : input.due;

  const now = new Date();
  const updatedRaw = mergeFrontmatter(existingRaw, {
    ...updates,
    updated: now.toISOString(),
  });

  // Preserve the existing body verbatim (frontmatter-only change), plus the
  // human <title> and any unknown robin:* tags the meta-only rebuild can't.
  const html = assemblePage({
    slug: meta.slug,
    vaultRelativePath: resolved.vaultRelativePath,
    frontmatter: updatedRaw,
    bodyHtml: parsed.bodyHtml,
    updated: now,
    title: originalTitle || undefined,
    extraMeta,
  });
  await writePage(resolved.absolutePath, html);

  // Changelog: canonical Robin convention — a dated header line linking the task.
  const dateStr = now.toISOString().slice(0, 10);
  const changeParts: string[] = [];
  if (input.status !== undefined) changeParts.push(`status → ${input.status}`);
  if (input.priority !== undefined) changeParts.push(`priority → ${input.priority}`);
  if (input.owner !== undefined) changeParts.push(`owner → ${input.owner}`);
  if (input.due !== undefined) {
    changeParts.push(input.due === '' ? 'due cleared' : `due → ${input.due}`);
  }
  const change = changeParts.join(', ');
  const noteSuffix = input.note ? ` — ${input.note}` : '';
  const logEntry = `## [${dateStr}] task | Updated [[${meta.slug}]] (${change})${noteSuffix}`;
  await appendLog(ctx.vaultPath, 'changelog', logEntry);

  return {
    path: resolved.vaultRelativePath,
    slug: resolved.slug,
    status: input.status ?? meta.status,
    updated: now.toISOString(),
    log_entry: logEntry,
  };
}

/** Reconstruct a minimal frontmatter dict from RobinMeta for re-assembly. */
function rawFromMeta(meta: import('@robin/converter').RobinMeta): Record<string, unknown> {
  const raw: Record<string, unknown> = { type: meta.type };
  if (meta.summary) raw.summary = meta.summary;
  // Carry lifecycle under the canonical `status` key, folding a legacy `state`
  // value in so a status-less / state-only page converges on rewrite.
  const status = meta.status ?? meta.state;
  if (status) raw.status = status;
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
