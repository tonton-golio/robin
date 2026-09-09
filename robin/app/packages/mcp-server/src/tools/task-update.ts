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

import { z } from "zod/v4";
import { frontmatterFromMeta, normalizeTaskPatch, applyTaskPatch } from "@robin/converter";
import { hashHtml } from "@robin/vault-io";
import { resolveRef, mcpError } from "../resolve.js";
import {
  readPageWithRaw,
  extractMeta,
  extractTitle,
  extractUnknownMetaTags,
  writePage,
  assemblePage,
  appendLog,
} from "../html-utils.js";
import type { ToolContext } from "../types.js";

export const TaskUpdateInputSchema = z.object({
  ref: z.string().min(1).describe("Task slug or vault-relative path"),
  status: z
    .string()
    .optional()
    .describe(
      "New lifecycle status, e.g. open | in-progress | done | blocked (canonical robin:status)",
    ),
  priority: z.string().optional().describe("New priority: p0 | p1 | p2 | p3"),
  owner: z.string().optional().describe("New owner"),
  due: z
    .string()
    .optional()
    .describe("New due date / deadline (ISO-8601), or empty string to clear"),
  start: z
    .string()
    .optional()
    .describe("New planned start date (ISO-8601), or empty string to clear"),
  end: z.string().optional().describe("New planned end date (ISO-8601), or empty string to clear"),
  kind: z
    .string()
    .optional()
    .describe("Task hierarchy kind: outcome | workstream | task (empty string clears)"),
  parent: z
    .string()
    .optional()
    .describe("Immediate parent task slug (workstream or outcome); empty string clears"),
  project: z.string().optional(),
  category: z.string().optional(),
  next_action: z.string().optional().describe("Concrete next action; empty string clears"),
  acceptance: z.string().optional().describe("Completion evidence; empty string clears"),
  size: z.number().optional(),
  planned: z.string().optional(),
  note: z.string().optional().describe("Optional changelog note appended after the status change"),
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
  ctx: ToolContext,
): Promise<TaskUpdateOutput> {
  let updates;
  try { updates = normalizeTaskPatch(input); }
  catch (error) { throw mcpError(-32602, error instanceof Error ? error.message : 'Invalid task update', undefined); }
  if (!Object.keys(updates).length) throw mcpError(-32602, 'task.update requires at least one task field', undefined);

  const resolved = await resolveRef(input.ref, ctx);
  const { parsed, html: originalHtml } = await readPageWithRaw(resolved.absolutePath);
  const meta = extractMeta(parsed, resolved.vaultRelativePath);
  if (meta.type !== 'task' || !resolved.vaultRelativePath.startsWith('brain/tasks/')) {
    throw mcpError(-32602, 'task.update requires a task under brain/tasks/', undefined);
  }
  // Preserve metadata the lossy RobinMeta round-trip would drop: the human
  // <title> (no RobinMeta field) and any non-vocabulary robin:* tag
  // (robin:review-by, and other custom tags).
  const originalTitle = extractTitle(originalHtml);
  const extraMeta = extractUnknownMetaTags(parsed);

  // Reconstruct the existing frontmatter from meta (v0.2 pages carry no inline
  // frontmatter JSON; <head> meta tags are authoritative).
  const existingRaw =
    (parsed.frontmatter as Record<string, unknown> | null) ?? frontmatterFromMeta(meta);

  const now = new Date();
  const updatedRaw: Record<string, unknown> = { ...applyTaskPatch(existingRaw, updates), updated: now.toISOString() };

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
  await writePage(resolved.absolutePath, html, {
    expectedHash: hashHtml(originalHtml),
  });

  // Changelog: canonical Robin convention — a dated header line linking the task.
  const dateStr = now.toISOString().slice(0, 10);
  const changeParts = Object.entries(updates).map(([key, value]) => value === null ? `${key} cleared` : `${key} → ${value}`);
  const change = changeParts.join(", ");
  const noteSuffix = input.note ? ` — ${input.note}` : "";
  const logEntry = `## [${dateStr}] task | Updated [[${meta.slug}]] (${change})${noteSuffix}`;
  await appendLog(ctx.vaultPath, "changelog", logEntry);

  return {
    path: resolved.vaultRelativePath,
    slug: resolved.slug,
    status: typeof updatedRaw.status === "string" ? updatedRaw.status : meta.status,
    updated: now.toISOString(),
    log_entry: logEntry,
  };
}
