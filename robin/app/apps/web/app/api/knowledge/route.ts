import { NextRequest, NextResponse } from 'next/server';
import { searchMemories, type MemoryStatus } from '@robin/memory';
import { search as searchPages } from '@/lib/indexer-client';
import { locateVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEMORY_STATUSES = new Set(['tentative', 'active', 'superseded', 'rejected', 'archived']);

function statuses(value: string | null): MemoryStatus[] {
  const parsed = (value ?? 'active,tentative')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const valid = parsed.filter((item): item is MemoryStatus => MEMORY_STATUSES.has(item));
  return valid.length ? valid : ['active', 'tentative'];
}

function resultLimit(value: string | null): number {
  const parsed = Number(value ?? '12');
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 50) : 12;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').trim();
  const k = resultLimit(searchParams.get('k'));

  if (!query) {
    return NextResponse.json({
      query,
      memory: { mode: 'lexical', hits: [] },
      pages: { mode: 'fallback', hits: [] },
    });
  }

  const [memoryHits, pageResult] = await Promise.all([
    searchMemories(locateVault(), {
      query,
      k,
      status: statuses(searchParams.get('status')),
    }),
    searchPages(query, k),
  ]);

  return NextResponse.json({
    query,
    memory: {
      mode: 'lexical',
      hits: memoryHits,
    },
    pages: pageResult,
  });
}
