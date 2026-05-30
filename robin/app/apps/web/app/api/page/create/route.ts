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
import { canonicalizeHtml } from '@robin/converter';
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

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const enrichedFm: Record<string, unknown> = {
    type,
    created: now,
    ...frontmatter,
  };

  const meta = {
    version: '0.1' as const,
    slug,
    path: safePath,
    type: type || 'note',
    updated: now,
    created: now,
    summary: typeof frontmatter['summary'] === 'string' ? frontmatter['summary'] : undefined,
    state: typeof frontmatter['state'] === 'string' ? frontmatter['state'] : undefined,
    owner: typeof frontmatter['owner'] === 'string' ? frontmatter['owner'] : undefined,
    priority: typeof frontmatter['priority'] === 'string' ? frontmatter['priority'] : undefined,
    due: typeof frontmatter['due'] === 'string' ? frontmatter['due'] : undefined,
    role: typeof frontmatter['role'] === 'string' ? frontmatter['role'] : undefined,
    relationship: typeof frontmatter['relationship'] === 'string'
      ? (frontmatter['relationship'] as import('@robin/converter').RobinMeta['relationship'])
      : undefined,
    started: undefined,
    date: undefined,
    duration: undefined,
    tier: undefined,
    tags: Array.isArray(frontmatter['tags'])
      ? (frontmatter['tags'] as string[]).filter((t): t is string => typeof t === 'string')
      : [],
    attendees: [],
    sources: [],
    unknownKeys: [],
  };

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
