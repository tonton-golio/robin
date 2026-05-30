/**
 * POST /api/meeting/transcribe
 * Body: { audioPath: string }  (vault-relative path)
 *
 * Returns: { transcript: string, segments?: Segment[] }
 *
 * Delegates to lib/whisper.ts which respects ROBIN_WHISPER_MODE env.
 *
 * V1 LIMITATION: This is synchronous HTTP. A 30-min meeting may take ~2 min
 * to transcribe with whisper.cpp local mode. The connection stays open during
 * that time. Phase 2 should convert this to a streaming/SSE endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { transcribe } from '@/lib/whisper';
import { vaultPath } from '@/lib/vault';
import { normalizeVaultFilePath } from '@/lib/vault-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Allow a generous timeout for local whisper (30min audio ~= 2min CPU)
export const maxDuration = 300; // seconds — only respected on Vercel

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { audioPath?: unknown };
  try {
    body = await request.json() as { audioPath?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const audioPath = body.audioPath;
  if (typeof audioPath !== 'string' || !audioPath) {
    return NextResponse.json(
      { error: 'Missing or invalid `audioPath` field (must be a non-empty string)' },
      { status: 400 },
    );
  }

  // Resolve as a vault-relative path under the allowlist. Absolute paths and
  // `..` escapes are rejected — never transcribe arbitrary files on disk.
  const safeAudioPath = normalizeVaultFilePath(audioPath);
  if (!safeAudioPath) {
    return NextResponse.json({ error: 'invalid audioPath' }, { status: 400 });
  }
  const absPath = vaultPath(safeAudioPath);

  // Verify the file exists before handing off (gives a clearer error than
  // whatever whisper-node would throw).
  const whisperMode = process.env['ROBIN_WHISPER_MODE'] ?? 'local';
  if (whisperMode !== 'stub') {
    try {
      await fs.access(absPath);
    } catch {
      return NextResponse.json(
        { error: `Audio file not found: ${audioPath}` },
        { status: 404 },
      );
    }
  }

  try {
    const result = await transcribe(absPath);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[transcribe] error', err);
    return NextResponse.json(
      {
        error: 'Transcription failed',
        detail: err instanceof Error ? err.message : String(err),
        hint:
          'If whisper-node is not installed, set ROBIN_WHISPER_MODE=openai ' +
          'and provide OPENAI_API_KEY, or use ROBIN_WHISPER_MODE=stub for testing.',
      },
      { status: 500 },
    );
  }
}
