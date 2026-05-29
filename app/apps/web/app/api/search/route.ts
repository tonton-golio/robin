import { NextRequest, NextResponse } from 'next/server';
import { search } from '@/lib/indexer-client';

/**
 * GET /api/search?q=...&k=20
 * Returns { hits: SearchHit[], mode: 'indexer' | 'fallback', query: string }
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const k = Math.min(parseInt(searchParams.get('k') ?? '20', 10), 100);

  if (!q.trim()) {
    return NextResponse.json({ hits: [], mode: 'fallback', query: q });
  }

  const result = await search(q, k);
  return NextResponse.json(result);
}
