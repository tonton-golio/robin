import { NextRequest, NextResponse } from 'next/server';
import {
  listMemories,
  saveMemory,
  searchMemories,
  type MemoryConfidence,
  type MemoryStatus,
  type MemoryTier,
  type MemoryType,
} from '@robin/memory';
import { locateVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEMORY_STATUSES = new Set(['tentative', 'active', 'superseded', 'rejected', 'archived']);
const MEMORY_TIERS = new Set(['working', 'episodic', 'semantic', 'procedural']);
const MEMORY_TYPES = new Set([
  'preference',
  'correction',
  'decision',
  'pattern',
  'procedure',
  'project',
  'person',
  'repo',
  'task',
  'other',
]);
const MEMORY_CONFIDENCES = new Set(['low', 'medium', 'high']);
// Mirrors the MCP MemorySourceSchema so both writers to brain/memory/events.jsonl
// validate `source` the same way. Without this the web route persisted a source
// with no kind/ref into the durable log.
const MEMORY_SOURCE_KINDS = new Set([
  'annotation',
  'conversation',
  'meeting',
  'manual',
  'tool',
  'repo',
  'other',
]);

function splitParam(value: string | null): string[] | undefined {
  const values = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

function statuses(value: string | null): MemoryStatus[] | undefined {
  const parsed = splitParam(value);
  if (!parsed) return undefined;
  return parsed.filter((item): item is MemoryStatus => MEMORY_STATUSES.has(item));
}

function types(value: string | null): MemoryType[] | undefined {
  const parsed = splitParam(value);
  if (!parsed) return undefined;
  return parsed.filter((item): item is MemoryType => MEMORY_TYPES.has(item));
}

function tiers(value: string | null): MemoryTier[] | undefined {
  const parsed = splitParam(value);
  if (!parsed) return undefined;
  return parsed.filter((item): item is MemoryTier => MEMORY_TIERS.has(item));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') ?? undefined;
  const k = Number(searchParams.get('k') ?? '20');
  const input = {
    query,
    k: Number.isFinite(k) && k > 0 ? Math.min(Math.floor(k), 100) : 20,
    status: statuses(searchParams.get('status')) ?? ['active', 'tentative'],
    type: types(searchParams.get('type')),
    tier: tiers(searchParams.get('tier')),
    scope: searchParams.get('scope') ?? undefined,
    tags: splitParam(searchParams.get('tags')),
  };

  const vault = locateVault();
  if (query) {
    const hits = await searchMemories(vault, input);
    return NextResponse.json({ mode: 'search', hits });
  }

  const memories = await listMemories(vault, input);
  return NextResponse.json({ mode: 'list', memories: memories.slice(0, input.k) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const type = body['type'];
  const confidence = body['confidence'];
  const tier = body['tier'];
  const status = body['status'];
  const subject = body['subject'];
  const summary = body['summary'];
  const source = body['source'];

  if (typeof type !== 'string' || !MEMORY_TYPES.has(type)) {
    return NextResponse.json({ error: 'invalid_type' }, { status: 400 });
  }
  if (typeof subject !== 'string' || !subject.trim()) {
    return NextResponse.json({ error: 'invalid_subject' }, { status: 400 });
  }
  if (typeof summary !== 'string' || !summary.trim()) {
    return NextResponse.json({ error: 'invalid_summary' }, { status: 400 });
  }
  // Validate the source SHAPE (kind enum + non-empty ref), not just that it is an
  // object — arrays are objects, and `{}` would otherwise persist a kind/ref-less
  // source into the durable event log.
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
  }
  const sourceRec = source as Record<string, unknown>;
  if (typeof sourceRec['kind'] !== 'string' || !MEMORY_SOURCE_KINDS.has(sourceRec['kind'])) {
    return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
  }
  if (typeof sourceRec['ref'] !== 'string' || !sourceRec['ref'].trim()) {
    return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
  }

  const memory = await saveMemory(locateVault(), {
    type: type as MemoryType,
    tier: typeof tier === 'string' && MEMORY_TIERS.has(tier) ? tier as MemoryTier : undefined,
    scope: typeof body['scope'] === 'string' ? body['scope'] : undefined,
    subject,
    summary,
    body: typeof body['body'] === 'string' ? body['body'] : undefined,
    tags: Array.isArray(body['tags']) ? body['tags'].filter((tag): tag is string => typeof tag === 'string') : undefined,
    links: Array.isArray(body['links']) ? body['links'].filter((link): link is string => typeof link === 'string') : undefined,
    source: source as Parameters<typeof saveMemory>[1]['source'],
    status: typeof status === 'string' && MEMORY_STATUSES.has(status) ? status as MemoryStatus : undefined,
    confidence: typeof confidence === 'string' && MEMORY_CONFIDENCES.has(confidence)
      ? confidence as MemoryConfidence
      : undefined,
    supersedes: Array.isArray(body['supersedes'])
      ? body['supersedes'].filter((id): id is string => typeof id === 'string')
      : undefined,
    merge: typeof body['merge'] === 'boolean' ? body['merge'] : undefined,
  });

  return NextResponse.json({ memory }, { status: 201 });
}
