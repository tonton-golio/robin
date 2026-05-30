/**
 * POST /api/meeting/upload
 * Accepts a multipart form with an `audio` file field and an optional
 * `durationSec` field. Saves the audio to:
 *   <vault>/inbox/meetings/audio/<ISO-timestamp>.webm
 *
 * Returns: { audioPath: string, durationSec: number | null }
 * audioPath is vault-relative.
 *
 * Next.js App Router exposes multipart uploads through request.formData().
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';
import { vaultPath } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hard ceiling on a single uploaded recording. The recorder caps its own
// in-memory audio buffer at ~400 MB (≈6.5h of opus@128kbps); a little headroom
// above that rejects anything pathological — a runaway script, a corrupt
// multi-GB body. Returns 413 over the cap.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Reject obviously-oversized bodies via Content-Length BEFORE request.formData()
  // buffers the entire multipart payload into memory. This is the cheap guard for
  // the common runaway case (clients reliably send Content-Length); a chunked body
  // without Content-Length still gets buffered by formData() and is only caught by
  // the post-parse size check below.
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `Uploaded audio file is too large (${contentLength} bytes; limit ${MAX_UPLOAD_BYTES})`,
      },
      { status: 413 },
    );
  }

  // Next.js App Router gives us a Web API Request (with formData()).
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to parse multipart form', detail: String(err) },
      { status: 400 },
    );
  }

  const audioEntry = formData.get('audio');
  const durationRaw = formData.get('durationSec');
  const durationSec = durationRaw ? parseFloat(String(durationRaw)) : null;

  if (!audioEntry || !(audioEntry instanceof Blob)) {
    return NextResponse.json(
      { error: 'Missing `audio` file field in multipart form' },
      { status: 400 },
    );
  }

  // If the blob is empty, treat it as a missing file (curl -F audio=@/dev/null)
  if (audioEntry.size === 0) {
    return NextResponse.json(
      { error: 'Uploaded audio file is empty (0 bytes)' },
      { status: 422 },
    );
  }

  // Post-parse size guard: catches a chunked/no-Content-Length body that slipped
  // past the header pre-check above (formData() has already buffered it by now,
  // so this no longer prevents the memory spend for that case — it just rejects
  // before we write to disk).
  if (audioEntry.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `Uploaded audio file is too large (${audioEntry.size} bytes; limit ${MAX_UPLOAD_BYTES})`,
      },
      { status: 413 },
    );
  }

  // Build destination path
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${ts}.webm`;
  const audioDir = vaultPath('inbox', 'meetings', 'audio');
  const absPath = path.join(audioDir, filename);
  const relPath = path.join('inbox', 'meetings', 'audio', filename);

  // Ensure directory exists
  await fs.mkdir(audioDir, { recursive: true });

  // Stream the blob straight to disk instead of materializing the whole payload
  // as one Buffer — memory stays flat regardless of recording length. If the
  // write fails partway, remove the partial file so we never leave a truncated,
  // undecodable recording behind.
  try {
    await pipeline(
      Readable.fromWeb(audioEntry.stream() as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(absPath),
    );
  } catch (err) {
    await fs.rm(absPath, { force: true }).catch(() => {});
    return NextResponse.json(
      { error: 'Failed to write uploaded audio', detail: String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json({ audioPath: relPath, durationSec });
}
