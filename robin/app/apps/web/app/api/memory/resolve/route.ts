import { NextRequest, NextResponse } from 'next/server';
import {
  resolveMemory,
  saveMemory,
  type MemoryConfidence,
  type MemoryStatus,
  type MemoryTier,
  type MemoryType,
} from '@robin/memory';
import { locateVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Thin lifecycle endpoint for the Memory review queue. The human — never the agent —
// confirms / rejects / archives / supersedes a belief here. Every call appends a
// `memory.resolved` event to the append-only brain/memory/events.jsonl; nothing is
// ever erased. Supersede additionally mints a tentative successor via saveMemory
// BEFORE resolving the predecessor, then links the chain with superseded_by.
//
// The client degrades to read-only when this route is absent, so keep the contract
// small and stable: { id, status, resolution, superseded_by?, successor? }.

// `tentative` is included so the client's single-level Undo can append a
// compensating memory.resolved event that reverts a confirm/reject/archive
// (the log is append-only — Undo cannot erase, only walk the belief back).
const RESOLVABLE = new Set<MemoryStatus>([
  'tentative',
  'active',
  'superseded',
  'rejected',
  'archived',
]);
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

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const id = str(body['id']);
  const status = body['status'];
  const resolution = str(body['resolution']);

  if (!id) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  if (typeof status !== 'string' || !RESOLVABLE.has(status as MemoryStatus)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }
  if (!resolution) {
    return NextResponse.json({ error: 'resolution_required' }, { status: 400 });
  }

  const vault = locateVault();

  try {
    // Supersede: mint the successor first so we can link the chain in one round-trip.
    let successorId: string | undefined;
    let successor: Awaited<ReturnType<typeof saveMemory>> | undefined;
    if (status === 'superseded') {
      const successorInput = body['successor'];
      if (!successorInput || typeof successorInput !== 'object' || Array.isArray(successorInput)) {
        return NextResponse.json({ error: 'successor_required' }, { status: 400 });
      }
      const rec = successorInput as Record<string, unknown>;
      const subject = str(rec['subject']);
      const summary = str(rec['summary']);
      if (!subject || !summary) {
        return NextResponse.json({ error: 'successor_incomplete' }, { status: 400 });
      }
      const type = rec['type'];
      const tier = rec['tier'];
      const confidence = rec['confidence'];
      successor = await saveMemory(vault, {
        type:
          typeof type === 'string' && MEMORY_TYPES.has(type) ? (type as MemoryType) : 'correction',
        tier:
          typeof tier === 'string' && MEMORY_TIERS.has(tier) ? (tier as MemoryTier) : undefined,
        scope: str(rec['scope']),
        subject,
        summary,
        body: str(rec['body']),
        tags: Array.isArray(rec['tags'])
          ? rec['tags'].filter((t): t is string => typeof t === 'string')
          : undefined,
        links: Array.isArray(rec['links'])
          ? rec['links'].filter((l): l is string => typeof l === 'string')
          : undefined,
        source: {
          kind: 'manual',
          ref: 'memory ui · supersede by human',
          captured_at: new Date().toISOString(),
        },
        status: 'tentative',
        confidence:
          typeof confidence === 'string' && MEMORY_CONFIDENCES.has(confidence)
            ? (confidence as MemoryConfidence)
            : 'medium',
        supersedes: [id],
      });
      successorId = successor.id;
    }

    const superseded_by =
      status === 'superseded' ? successorId : str(body['superseded_by']) ?? undefined;

    const memory = await resolveMemory(vault, {
      id,
      status: status as MemoryStatus,
      resolution,
      superseded_by,
    });

    return NextResponse.json({ memory, successor: successor ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'resolve_failed';
    // "not found" is a client-correctable condition; everything else is 500.
    const notFound = /not found/i.test(message);
    return NextResponse.json({ error: message }, { status: notFound ? 404 : 500 });
  }
}
