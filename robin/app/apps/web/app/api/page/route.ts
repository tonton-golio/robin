import { NextRequest, NextResponse } from 'next/server';
import { readPage } from '@/lib/read-page';
import { getBacklinks } from '@/lib/indexer-client';
import { normalizeVaultFilePath } from '@/lib/vault-file';

/**
 * GET /api/page?path=brain/_index.html
 * Returns { meta, blocks, bodyHtml, backlinks }
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path');

  if (!filePath) {
    return NextResponse.json({ error: 'missing path param' }, { status: 400 });
  }

  // Enforce the vault allowlist — `readPage` joins this straight onto the vault
  // root with no traversal guard of its own.
  const safePath = normalizeVaultFilePath(filePath);
  if (!safePath || !safePath.endsWith('.html')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const page = await readPage(safePath);

  if ('error' in page) {
    const status = page.error === 'not_found' ? 404 : 500;
    return NextResponse.json({ error: page.error, path: page.filePath }, { status });
  }

  const backlinks = await getBacklinks(page.meta.slug);

  return NextResponse.json({
    meta: page.meta,
    blocks: page.blocks,
    bodyHtml: page.bodyHtml,
    backlinks,
    title: page.title,
    mtime: page.mtime,
  });
}
