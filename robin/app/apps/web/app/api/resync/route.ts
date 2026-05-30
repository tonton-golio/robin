import { NextResponse } from 'next/server';
import { reindex } from '@/lib/indexer-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Server-side cap so a wedged indexer can't hold the request open forever. */
const REINDEX_TIMEOUT_MS = 25_000;

/**
 * In-flight reindex shared across concurrent POSTs. The indexer writes a single
 * shared index.db with no internal lock, so two overlapping scans would race on
 * the same file. The Resync button re-enables ~1.6s after a (possibly timed-out)
 * response while the underlying scan may still be running, so a second click
 * MUST join the running scan rather than launch a parallel one. Pinned to the
 * process global so Next.js dev/HMR module re-evaluation can't reset it mid-scan.
 */
const INFLIGHT_KEY = Symbol.for('robin.resyncInFlight');
type GlobalWithInFlight = typeof globalThis & {
  [INFLIGHT_KEY]?: ReturnType<typeof reindex> | null;
};
const globalWithInFlight = globalThis as GlobalWithInFlight;

function runReindexOnce(): ReturnType<typeof reindex> {
  const existing = globalWithInFlight[INFLIGHT_KEY];
  if (existing) return existing;
  const promise = reindex();
  globalWithInFlight[INFLIGHT_KEY] = promise;
  // Clear the guard once the scan settles so the next Resync starts fresh. The
  // request-level timeout below only abandons *waiting*; it never cancels the
  // shared scan, so the guard must outlive a timed-out request.
  void promise.finally(() => {
    if (globalWithInFlight[INFLIGHT_KEY] === promise) {
      globalWithInFlight[INFLIGHT_KEY] = null;
    }
  });
  return promise;
}

/**
 * POST /api/resync
 * Re-index brain/ and out/ on demand into the shared SQLite index so search
 * and backlinks reflect the current files. Returns honest stats for the UI.
 * A timeout bounds the work so the client's Resync button can't hang forever;
 * a single in-flight scan is shared so a re-click can't launch a concurrent one.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const result = await Promise.race([
      runReindexOnce(),
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
