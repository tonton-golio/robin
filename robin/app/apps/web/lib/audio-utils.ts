/**
 * Browser-side audio utilities.
 * These functions run in the client only — never import from server components.
 */

/**
 * Convert a Blob to an object URL safe for <audio src=...> or <a href=...>.
 * The caller is responsible for calling URL.revokeObjectURL when done.
 */
export function blobToObjectURL(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * `decodeAudioData` reads the whole file into a decoded PCM AudioBuffer in
 * memory — for opus@128kbps that's ~1.3 MB/s of compressed audio expanding to
 * ~10 MB/min of float32 PCM. Decoding a long meeting just to learn its length
 * is wasteful and can OOM the tab, and the recorder already tracks elapsed
 * wall-clock time precisely. So above this size we skip the decode entirely.
 *
 * ~12 MB of opus ≈ 75 min of speech, well past any meeting we'd ever decode.
 */
const MAX_DECODE_BYTES = 12 * 1024 * 1024;

/**
 * Best-effort audio duration in seconds.
 *
 * `fallbackSec` is the recorder's tracked elapsed time — pass it whenever you
 * have it. We prefer it (it's already exact) for large blobs and use the
 * AudioContext decode only as a refinement for small clips. Returns
 * `fallbackSec` (or null) rather than blocking on a multi-MB decode.
 *
 * @param blob        the recorded audio
 * @param fallbackSec elapsed seconds the recorder measured (optional)
 */
export async function getBlobDurationSec(
  blob: Blob,
  fallbackSec?: number,
): Promise<number | null> {
  // Large blob (or no AudioContext) → trust the recorder's elapsed time and
  // skip the expensive full-file decode entirely.
  if (blob.size > MAX_DECODE_BYTES || typeof AudioContext === 'undefined') {
    return fallbackSec ?? null;
  }
  // Hoist the context so it's released on BOTH the success and decode-rejection
  // paths. Chrome hard-limits concurrent AudioContexts (~6 per document); a
  // decode that rejects (corrupt/partial blob, odd container) and never closes
  // the context would, after a few failures, exhaust the pool and break both
  // meeting recording and the voice interview (which also construct contexts).
  let ctx: AudioContext | null = null;
  try {
    const buffer = await blob.arrayBuffer();
    ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(buffer);
    return decoded.duration;
  } catch {
    return fallbackSec ?? null;
  } finally {
    // .catch keeps a failing close() from masking the real return value.
    await ctx?.close().catch(() => {});
  }
}

/**
 * Format a duration (seconds) as HH:MM:SS or MM:SS.
 */
export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds) % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);

  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');

  if (h > 0) {
    return `${h}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Pick the best supported mimeType for MediaRecorder.
 * Prefers opus-in-webm (smallest, best quality for speech).
 */
export function bestMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];

  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }

  return ''; // let the browser decide
}
