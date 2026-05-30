import { NextRequest, NextResponse } from 'next/server';
import { search } from '@/lib/indexer-client';

/**
 * GET /api/search?q=...&k=20
 * Returns { hits: SearchHit[], mode: 'indexer' | 'fallback', query: string }
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  // Parse k defensively: a malformed/empty k (NaN) must fall back to the default,
  // never bypass the 100-cap and dump the whole index. Mirrors /api/knowledge.
  const rawK = Number(searchParams.get('k'));
  const k = Number.isFinite(rawK) && rawK > 0 ? Math.min(Math.floor(rawK), 100) : 20;

  if (!q.trim()) {
    return NextResponse.json({ hits: [], mode: 'fallback', query: q });
  }

  const result = await search(q, k);
  return NextResponse.json(result);
}
