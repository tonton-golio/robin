/**
 * GET  /api/edits          → recent edit events (newest-first). ?path= scopes to
 *                            one page; ?limit= caps the count.
 * POST /api/edits           → { action: 'revert', id } restores that edit's snapshot.
 *
 * Mirrors /api/annotations: a thin wrapper over the edit-log store + the revert
 * server action. See robin/app/docs/edit-log-ingest.md.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listEdits } from '@/lib/edit-store';
import { revertToSnapshot } from '@/lib/actions/edit';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const pagePath = params.get('path') ?? undefined;
  const limitRaw = params.get('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const edits = await listEdits({
    ...(pagePath ? { pagePath } : {}),
    ...(limit && Number.isFinite(limit) ? { limit } : {}),
  });
  return NextResponse.json({ edits });
}

interface RevertBody {
  action?: string;
  id?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: RevertBody;
  try {
    body = (await request.json()) as RevertBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (body.action && body.action !== 'revert') {
    return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: 'missing id' }, { status: 400 });
  }

  const result = await revertToSnapshot(body.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
