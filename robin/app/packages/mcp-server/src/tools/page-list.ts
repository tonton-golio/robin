/**
 * page.list — List pages with optional filtering.
 *
 * Returns metadata only (no body). Uses the indexer if available,
 * falls back to filesystem scan.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v4';
import { parseRobinHtml } from '@robin/indexer';
import { findVaultHtmlFiles } from '../html-utils.js';
import type { ToolContext, PageListOutput, PageListItem } from '../types.js';

export const PageListInputSchema = z.object({
  folder: z.string().optional().describe('Vault-relative folder to restrict search'),
  type: z.string().optional().describe('Filter by robin:type'),
  state: z.string().optional().describe('Filter by lifecycle status (canonical robin:status; robin:state is accepted as a synonym)'),
  updated_since: z.string().optional().describe('Filter by updated >= ISO-8601 date'),
});

export type PageListInput = z.infer<typeof PageListInputSchema>;

export async function pageList(
  input: PageListInput,
  ctx: ToolContext
): Promise<PageListOutput> {
  // Try indexer first
  if (ctx.indexer) {
    try {
      return listFromIndexer(input, ctx);
    } catch {
      // fall through to filesystem
    }
  }

  return listFromFilesystem(input, ctx);
}

function listFromIndexer(input: PageListInput, ctx: ToolContext): PageListOutput {
  const db = ctx.indexer!.db;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (input.folder) {
    conditions.push("path LIKE ?");
    params.push(`${input.folder}/%`);
  }
  if (input.type) {
    conditions.push("type = ?");
    params.push(input.type);
  }
  if (input.state) {
    conditions.push("state = ?");
    params.push(input.state);
  }
  if (input.updated_since) {
    conditions.push("updated >= ?");
    params.push(input.updated_since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT path, slug, type, title, summary, updated FROM pages ${where} ORDER BY updated DESC`;
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<{
    path: string;
    slug: string;
    type: string;
    title: string | null;
    summary: string | null;
    updated: string | null;
  }>;

  return {
    items: rows.map((r) => ({
      path: r.path,
      slug: r.slug,
      type: r.type,
      title: r.title,
      summary: r.summary,
      updated: r.updated,
    })),
  };
}

function listFromFilesystem(input: PageListInput, ctx: ToolContext): PageListOutput {
  const root = input.folder
    ? path.join(ctx.vaultPath, input.folder)
    : ctx.vaultPath;

  const htmlFiles = findVaultHtmlFiles(root);
  const items: PageListItem[] = [];

  for (const absPath of htmlFiles) {
    try {
      const html = fs.readFileSync(absPath, 'utf8');
      const parsed = parseRobinHtml(html);
      const m = parsed.meta as Record<string, string | string[]>;

      const get = (key: string): string | undefined => {
        const v = m[`robin:${key}`];
        return Array.isArray(v) ? v[0] : v;
      };

      const type = get('type') ?? 'note';
      // `robin:status` and `robin:state` are synonyms; on-disk tasks are
      // status-keyed, so fall back to it or a `state:` filter returns empty in
      // no-index mode (mirror read-page.ts buildMeta).
      const state = get('state') ?? get('status');
      const updated = get('updated') ?? null;

      // Apply filters
      if (input.type && type !== input.type) continue;
      if (input.state && state !== input.state) continue;
      if (input.updated_since && updated && updated < input.updated_since) continue;

      const relPath = path.relative(ctx.vaultPath, absPath);
      const slug = path.basename(absPath, '.html');
      // Title is the document's <title> (matches the indexer's
      // document_title_from_html), falling back to the slug — NOT the
      // robin:type value, which was a copy-paste bug that surfaced "task" /
      // "project" as the title of every page in no-index mode.
      const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
      const title = titleMatch?.[1]?.trim() || slug;
      items.push({
        path: relPath,
        slug,
        type,
        title,
        summary: get('summary') ?? null,
        updated,
      });
    } catch {
      // skip unreadable files
    }
  }

  return { items };
}
