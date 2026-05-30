import { NextResponse } from 'next/server';
import { reindex } from '@/lib/indexer-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Server-side cap so a wedged indexer can't hold the request open forever. */
const REINDEX_TIMEOUT_MS = 25_000;

/**
 * POST /api/resync
 * Re-index brain/ and out/ on demand into the shared SQLite index so search
 * and backlinks reflect the current files. Returns honest stats for the UI.
 * A timeout bounds the work so the client's Resync button can't hang forever.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const result = await Promise.race([
      reindex(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`reindex timed out after ${REINDEX_TIMEOUT_MS / 1000}s`)), REINDEX_TIMEOUT_MS),
      ),
    ]);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
