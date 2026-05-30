/**
 * POST /api/meeting/save-transcript
 *
 * Body (JSON):
 *   transcript:        string   — full transcript text (may include **Speaker:** markup)
 *   slug?:             string   — kebab-case slug for the meeting (e.g. "standup-weekly")
 *   title?:            string   — human meeting title (from AI processing or user edit)
 *   summary?:          string   — TL;DR summary (from AI processing or user edit)
 *   calendarEventId?:  string   — Google Calendar event ID (informational only for now)
 *   attendees?:        string   — comma-separated list of attendee names
 *   audioPath?:        string   — vault-relative path to the audio file
 *   durationSec?:      number
 *
 * Saves to:
 *   <vault>/inbox/meetings/<ISO-date>-<slug>.md
 *
 * Returns: { path: string, slug: string, ingestUrl: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { vaultPath } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Find a free filename in `dir` for `<isoDate>-<slug>.md`, appending `-2`,
 * `-3`, … to the slug if the base name is already taken. Prevents a second
 * same-day meeting with the same slug from silently overwriting the first.
 * Returns both the resolved filename and the (possibly suffixed) slug.
 *
 * NB: this is a best-effort check, not an atomic reservation — two requests
 * racing for the same slug in the same second could still collide. For a
 * single-user local tool that's an acceptable tradeoff; the common case
 * (re-saving / a later distinct meeting) is handled.
 */
async function resolveFreeName(
  dir: string,
  isoDate: string,
  slug: string,
): Promise<{ filename: string; slug: string }> {
  for (let i = 1; i < 1000; i++) {
    const candidateSlug = i === 1 ? slug : `${slug}-${i}`;
    const filename = `${isoDate}-${candidateSlug}.md`;
    try {
      await fs.access(path.join(dir, filename));
      // Exists → try the next suffix.
    } catch (err) {
      // Only ENOENT means "free to use". Any other error (e.g. EACCES) is a real
      // problem — rethrow it instead of treating it as a free name that would
      // then collide on the wx write.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // Does not exist → free to use.
      return { filename, slug: candidateSlug };
    }
  }
  // Pathological fallback: 1000 collisions in one day — disambiguate by time.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const candidateSlug = `${slug}-${stamp}`;
  return { filename: `${isoDate}-${candidateSlug}.md`, slug: candidateSlug };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    transcript?: unknown;
    slug?: unknown;
    title?: unknown;
    summary?: unknown;
    calendarEventId?: unknown;
    attendees?: unknown;
    audioPath?: unknown;
    durationSec?: unknown;
  };

  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const transcript = body.transcript;
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return NextResponse.json(
      { error: 'Missing or empty `transcript` field' },
      { status: 400 },
    );
  }

  const now = new Date();
  const isoDate = now.toISOString().split('T')[0]!; // YYYY-MM-DD
  const isoTimestamp = now.toISOString(); // full ISO for frontmatter

  // Derive slug: use provided slug, or auto-generate from timestamp
  const rawSlug = typeof body.slug === 'string' && body.slug.trim()
    ? slugify(body.slug.trim())
    : `meeting-${isoDate}`;
  const baseSlug = rawSlug || `meeting-${isoDate}`;

  const meetingsDir = vaultPath('inbox', 'meetings');

  // Ensure directory exists before probing for collisions.
  await fs.mkdir(meetingsDir, { recursive: true });

  // Parse attendees
  const attendeesRaw = typeof body.attendees === 'string' ? body.attendees : '';
  const attendees = attendeesRaw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Duration
  const durationSec = typeof body.durationSec === 'number' ? body.durationSec : null;
  const durationStr = durationSec != null
    ? `${Math.round(durationSec / 60)} min`
    : '';

  // Audio ref
  const audioPath = typeof body.audioPath === 'string' ? body.audioPath : '';

  // Calendar event ref
  const calendarEventId = typeof body.calendarEventId === 'string' ? body.calendarEventId : '';

  // Title + summary (from AI processing or user edit). Collapse to single-line
  // YAML-safe scalars — the ingest frontmatter parser is line-based.
  const toScalar = (v: unknown): string =>
    typeof v === 'string' ? v.replace(/\s+/g, ' ').replace(/"/g, "'").trim() : '';
  const summary = toScalar(body.summary);

  const buildContent = (resolvedSlug: string): string => {
    const title = toScalar(body.title) || resolvedSlug;
    const frontmatter = [
      '---',
      `type: meeting-source`,
      `date: ${isoDate}`,
      `title: "${title}"`,
      summary ? `summary: "${summary}"` : null,
      attendeesRaw ? `attendees: [${attendees.join(', ')}]` : null,
      durationStr ? `duration: "${durationStr}"` : null,
      audioPath ? `audio: ${audioPath}` : null,
      calendarEventId ? `calendar_event_id: ${calendarEventId}` : null,
      `updated: ${isoTimestamp}`,
      '---',
    ]
      .filter(line => line !== null)
      .join('\n');
    return `${frontmatter}\n\n${transcript.trim()}\n`;
  };

  // Resolve a non-colliding filename and write with flag:'wx' (fail-if-exists)
  // so we never silently overwrite. The wx write is the real guard for the race
  // between the access() probe and this write — but a lost race (EEXIST) must be
  // RETRIED under a fresh suffix, not surfaced as a 500 that drops the transcript.
  let relPath = '';
  let slug = '';
  let wrote = false;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5 && !wrote; attempt++) {
    const resolved = await resolveFreeName(meetingsDir, isoDate, baseSlug);
    const absPath = path.join(meetingsDir, resolved.filename);
    try {
      await fs.writeFile(absPath, buildContent(resolved.slug), { encoding: 'utf-8', flag: 'wx' });
      relPath = path.join('inbox', 'meetings', resolved.filename);
      slug = resolved.slug;
      wrote = true;
    } catch (err) {
      lastErr = err;
      // A same-second same-slug racing write won the name: re-resolve + retry.
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      // Any other error is fatal.
      return NextResponse.json(
        { error: 'Failed to write meeting file', detail: String(err) },
        { status: 500 },
      );
    }
  }

  if (!wrote) {
    return NextResponse.json(
      { error: 'Failed to write meeting file', detail: String(lastErr) },
      { status: 500 },
    );
  }

  // Ingest URL (real implementation in /api/ingest/meeting + ingest-meeting skill)
  const ingestUrl = `/api/ingest/meeting?path=${encodeURIComponent(relPath)}`;

  return NextResponse.json({ path: relPath, slug, ingestUrl });
}
