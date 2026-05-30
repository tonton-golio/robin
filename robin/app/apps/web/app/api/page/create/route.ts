/**
 * POST /api/page/create
 *
 * Body: { folder: string, slug: string, type: string, frontmatter: Record<string, unknown>, blocks: RobinBlock[] }
 * Response: 200 { ok: true, path: string } or 409 { error: 'conflict' }
 */

import { NextRequest, NextResponse } from 'next/server';
import type { RobinBlock } from '@robin/converter';
import fs from 'fs/promises';
import { vaultPath } from '@/lib/vault';
import { normalizeVaultFilePath } from '@/lib/vault-file';
import { canonicalizeHtml, normalizeFrontmatter } from '@robin/converter';
import { writePage, notifyIndexerWrite } from '@/lib/write-page';

interface CreateBody {
  folder: string;     // e.g. 'brain'
  slug: string;       // e.g. 'my-new-page' (no .html)
  type: string;
  frontmatter: Record<string, unknown>;
  blocks: RobinBlock[];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { folder, slug, type, frontmatter, blocks } = body;

  if (!folder || !slug) {
    return NextResponse.json({ error: 'folder and slug are required' }, { status: 400 });
  }

  // Validate slug: kebab-case, no path separators
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return NextResponse.json(
      { error: 'slug must be kebab-case lowercase ASCII' },
      { status: 400 }
    );
  }

  // Security: enforce the vault allowlist on the assembled path — `folder` is
  // otherwise unvalidated and could escape the vault.
  const safePath = normalizeVaultFilePath(`${folder}/${slug}.html`);
  if (!safePath) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  // Check for collision
  const absPath = vaultPath(safePath);
  try {
    await fs.access(absPath);
    // File exists — conflict
    return NextResponse.json({ error: 'conflict', path: safePath }, { status: 409 });
  } catch {
    // File doesn't exist — good to proceed
  }

  const now = new Date();
  const nowIso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const enrichedFm: Record<string, unknown> = {
    type,
    created: nowIso,
    ...frontmatter,
  };

  // Single source of truth: derive RobinMeta via the converter's
  // normalizeFrontmatter (correct version '0.2', status/state synonym handling,
  // size/date/tag/source coercion) instead of hand-building v0.1 meta here.
  // Keeps this legacy/MCP-facing route's output in lockstep with the server
  // action in lib/actions/page.ts and the indexer/reader expectations.
  const title = typeof enrichedFm['title'] === 'string' ? (enrichedFm['title'] as string) : slug;
  const { meta } = normalizeFrontmatter({
    frontmatter: enrichedFm,
    slug,
    outputPath: safePath,
    title,
    updated: now,
  });

  const defaultBlocks: RobinBlock[] = blocks.length > 0
    ? blocks
    : [{ kind: 'heading', level: 1, content: [{ kind: 'text', text: slug }] }];

  const html = canonicalizeHtml({ meta, frontmatter: enrichedFm, blocks: defaultBlocks });

  try {
    await writePage({ vaultRelativePath: safePath, html });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'write failed' },
      { status: 500 }
    );
  }

  void notifyIndexerWrite(safePath);

  return NextResponse.json(
    { ok: true, path: safePath, slug },
    {
      status: 200,
      headers: { 'X-Robin-Self-Write': '1' },
    }
  );
}
