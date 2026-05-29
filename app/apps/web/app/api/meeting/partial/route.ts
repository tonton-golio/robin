/**
 * POST /api/meeting/partial
 *
 * Crash-safety checkpoint for an in-progress live recording. The browser
 * recorder POSTs the committed (final) transcript-so-far on a short interval
 * while recording. If the tab crashes or is closed before the user hits
 * "Stop & save", the latest checkpoint survives on disk and the meeting isn't
 * lost — it can be recovered/ingested manually from:
 *
 *   <vault>/inbox/meetings/audio/<sessionId>.partial.txt
 *
 * Body (JSON):
 *   sessionId:  string   — stable id for this recording (timestamp-derived)
 *   transcript: string   — the committed transcript so far (full text, not a delta)
 *   durationSec?: number — elapsed seconds (informational header line)
 *
 * We write the *full* committed text each call (overwrite, not append) because
 * Deepgram hands us the entire committed line list on every commit, so the
 * latest POST is always the complete picture. Overwriting also keeps the file
 * from accumulating duplicated text.
 *
 * On successful "Stop & save" the recorder calls DELETE to remove the partial.
 *
 * Returns: { ok: true, partialPath: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { vaultPath } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Session ids come from the client. Restrict them to a safe charset and bound
 * the length so they can't escape the partials directory or be abused as a
 * path. We only ever join the sanitized value to a fixed directory.
 */
function safeSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return cleaned.length > 0 ? cleaned : null;
}

function partialAbsPath(sessionId: string): string {
  return vaultPath('inbox', 'meetings', 'audio', `${sessionId}.partial.txt`);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { sessionId?: unknown; transcript?: unknown; durationSec?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sessionId = safeSessionId(body.sessionId);
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing or invalid `sessionId`' }, { status: 400 });
  }

  const transcript = typeof body.transcript === 'string' ? body.transcript : '';
  const durationSec = typeof body.durationSec === 'number' ? body.durationSec : null;

  const header =
    `# Live meeting checkpoint (in progress)\n` +
    `# session: ${sessionId}\n` +
    `# updated: ${new Date().toISOString()}\n` +
    (durationSec != null ? `# elapsed: ${Math.round(durationSec)}s\n` : '') +
    `# This is an unsaved auto-checkpoint. If you're seeing it, a recording was\n` +
    `# interrupted before "Stop & save". Recover the text below.\n\n`;

  const absPath = partialAbsPath(sessionId);
  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, header + transcript, 'utf-8');
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to write checkpoint', detail: String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    partialPath: path.join('inbox', 'meetings', 'audio', `${sessionId}.partial.txt`),
  });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const sessionId = safeSessionId(new URL(request.url).searchParams.get('sessionId'));
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing or invalid `sessionId`' }, { status: 400 });
  }
  try {
    await fs.unlink(partialAbsPath(sessionId));
  } catch {
    // Already gone (or never written) — idempotent success.
  }
  return NextResponse.json({ ok: true });
}
