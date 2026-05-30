/**
 * POST /api/page/save
 *
 * Body: { path: string, frontmatter: Record<string, unknown>, blocks: RobinBlock[] }
 * Response: 200 { ok: true } or 4xx/5xx { error: string }
 *
 * MCP-aware: if ROBIN_MCP_URL is set, proxies the write to MCP's page.write tool.
 * Otherwise writes directly to disk via write-page.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { RobinBlock, RobinMeta } from '@robin/converter';
import { canonicalizeHtml } from '@robin/converter';
import { writePage, notifyIndexerWrite } from '@/lib/write-page';
import { normalizeVaultFilePath } from '@/lib/vault-file';
import path from 'path';

interface SaveBody {
  path: string;
  frontmatter: Record<string, unknown>;
  blocks: RobinBlock[];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { path: filePath, frontmatter, blocks } = body;

  if (!filePath || typeof filePath !== 'string') {
    return NextResponse.json({ error: 'missing path' }, { status: 400 });
  }

  if (!filePath.endsWith('.html')) {
    return NextResponse.json({ error: 'path must end with .html' }, { status: 400 });
  }

  // Security: enforce the vault allowlist (brain/inbox/out/logs) and reject
  // `..`/absolute/null — a bare `startsWith('..')` check is bypassable.
  const safePath = normalizeVaultFilePath(filePath);
  if (!safePath) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  // MCP-aware path
  const mcpUrl = process.env['ROBIN_MCP_URL'];
  if (mcpUrl) {
    return await writeThroughMcp(mcpUrl, { ...body, path: safePath });
  }

  // Build meta from frontmatter + path
  const slug = path.basename(safePath, '.html');
  const meta = buildMeta(slug, safePath, frontmatter);

  // Generate canonical HTML
  const html = canonicalizeHtml({ meta, frontmatter, blocks });

  try {
    await writePage({ vaultRelativePath: safePath, html });
  } catch (e) {
    console.error('[save] write failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'write failed' },
      { status: 500 }
    );
  }

  // Notify indexer (best-effort)
  void notifyIndexerWrite(safePath);

  return NextResponse.json(
    { ok: true, path: safePath, slug },
    {
      status: 200,
      headers: {
        'X-Robin-Self-Write': '1',
      },
    }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMeta(
  slug: string,
  filePath: string,
  frontmatter: Record<string, unknown>
): RobinMeta {
  const fm = frontmatter as Record<string, unknown>;

  const tags: string[] = [];
  const rawTags = fm['tags'];
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) if (typeof t === 'string') tags.push(t);
  } else if (typeof rawTags === 'string' && rawTags.trim()) {
    tags.push(...rawTags.split(',').map((t) => t.trim()).filter(Boolean));
  }

  const attendees: string[] = [];
  const rawAttendees = fm['attendees'];
  if (Array.isArray(rawAttendees)) {
    for (const a of rawAttendees) if (typeof a === 'string') attendees.push(a);
  }

  const sources: string[] = [];
  const rawSources = fm['source'] ?? fm['sources'];
  if (Array.isArray(rawSources)) {
    for (const s of rawSources) if (typeof s === 'string') sources.push(s);
  } else if (typeof rawSources === 'string' && rawSources.trim()) {
    sources.push(rawSources);
  }

  return {
    version: '0.1',
    slug,
    path: filePath,
    type: String(fm['type'] ?? 'note'),
    updated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    created: typeof fm['created'] === 'string' ? fm['created'] : undefined,
    summary: typeof fm['summary'] === 'string' ? fm['summary'] : undefined,
    state: typeof fm['state'] === 'string' ? fm['state'] : undefined,
    owner: typeof fm['owner'] === 'string' ? fm['owner'] : undefined,
    priority: typeof fm['priority'] === 'string' ? fm['priority'] : undefined,
    due: typeof fm['due'] === 'string' ? fm['due'] : undefined,
    role: typeof fm['role'] === 'string' ? fm['role'] : undefined,
    relationship: typeof fm['relationship'] === 'string'
      ? (fm['relationship'] as RobinMeta['relationship'])
      : undefined,
    started: typeof fm['started'] === 'string' ? fm['started'] : undefined,
    date: typeof fm['date'] === 'string' ? fm['date'] : undefined,
    duration: typeof fm['duration'] === 'string' ? fm['duration'] : undefined,
    tier: typeof fm['tier'] === 'string' ? fm['tier'] : undefined,
    tags,
    attendees,
    sources,
    unknownKeys: [],
  };
}

async function writeThroughMcp(mcpUrl: string, body: SaveBody): Promise<NextResponse> {
  try {
    const resp = await fetch(`${mcpUrl}/tools/page.write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json() as Record<string, unknown>;
    return NextResponse.json(json, {
      status: resp.status,
      headers: { 'X-Robin-Self-Write': '1' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `MCP write failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }
}
