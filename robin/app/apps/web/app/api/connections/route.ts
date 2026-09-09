import { NextRequest, NextResponse } from 'next/server';
import { getPageConnections } from '@/lib/indexer-client';
import { normalizeVaultFilePath } from '@/lib/vault-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function limitParam(value: string | null, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(Math.floor(parsed), 50) : fallback;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get('path');
  if (!rawPath) {
    return NextResponse.json({ error: 'missing path' }, { status: 400 });
  }

  const safePath = normalizeVaultFilePath(rawPath);
  if (!safePath || !safePath.endsWith('.html')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const connections = await getPageConnections(safePath, {
    trailLimit: limitParam(searchParams.get('trails'), 8),
    suggestionLimit: limitParam(searchParams.get('suggestions'), 8),
  });

  if (!connections) {
    return NextResponse.json({ error: 'not_found', path: safePath }, { status: 404 });
  }

  return NextResponse.json(connections);
}
