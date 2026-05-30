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
import path from 'path';
import { vaultPath } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  // Build destination path
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${ts}.webm`;
  const audioDir = vaultPath('inbox', 'meetings', 'audio');
  const absPath = path.join(audioDir, filename);
  const relPath = path.join('inbox', 'meetings', 'audio', filename);

  // Ensure directory exists
  await fs.mkdir(audioDir, { recursive: true });

  // Write the file
  const arrayBuffer = await audioEntry.arrayBuffer();
  await fs.writeFile(absPath, Buffer.from(arrayBuffer));

  return NextResponse.json({ audioPath: relPath, durationSec });
}
