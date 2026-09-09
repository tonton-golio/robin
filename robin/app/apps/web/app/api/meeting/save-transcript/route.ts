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
 *   meetingId?:        string   — stable capture id used for idempotent replay
 *   signals?:          object   — reviewed decisions, commitments, and conflicts
 *
 * Saves to:
 *   <vault>/inbox/meetings/<ISO-date>-<slug>.md
 *
 * Returns: { path: string, slug: string, ingestUrl: string }
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { durableWriteNew, withVaultLocks } from "@robin/vault-io";
import { type NextRequest, NextResponse } from "next/server";
import { coerceMeetingSignals, encodeMeetingSignals } from "@/lib/meeting-signals";
import { locateVault, vaultPath } from "@/lib/vault";
import { normalizeVaultReadPath } from "@/lib/vault-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Find a free filename in `dir` for `<isoDate>-<slug>.md`, appending `-2`,
 * `-3`, … to the slug if the base name is already taken. Prevents a second
 * same-day meeting with the same slug from silently overwriting the first.
 * Returns both the resolved filename and the (possibly suffixed) slug.
 *
 * The caller holds the capture-identity lock while resolving and creating the
 * file. The create-exclusive write remains a second guard against unrelated
 * same-slug captures racing for a filename.
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
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // Does not exist → free to use.
      return { filename, slug: candidateSlug };
    }
  }
  // Pathological fallback: 1000 collisions in one day — disambiguate by time.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
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
    meetingId?: unknown;
    signals?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const transcript = body.transcript;
  if (typeof transcript !== "string" || !transcript.trim()) {
    return NextResponse.json({ error: "Missing or empty `transcript` field" }, { status: 400 });
  }

  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const isoTimestamp = now.toISOString(); // full ISO for frontmatter

  const suppliedMeetingId =
    typeof body.meetingId === "string" ? body.meetingId.trim().toLowerCase() : "";
  if (suppliedMeetingId && !/^[a-z0-9][a-z0-9_-]{0,95}$/.test(suppliedMeetingId)) {
    return NextResponse.json({ error: "Invalid `meetingId`" }, { status: 400 });
  }
  const meetingId = suppliedMeetingId || `capture-${crypto.randomUUID()}`;

  // Derive slug: use provided slug, or auto-generate from timestamp
  const rawSlug =
    typeof body.slug === "string" && body.slug.trim()
      ? slugify(body.slug.trim())
      : `meeting-${isoDate}`;
  const baseSlug = rawSlug || `meeting-${isoDate}`;

  const meetingsDir = vaultPath("inbox", "meetings");

  // Ensure directory exists before probing for collisions.
  await fs.mkdir(meetingsDir, { recursive: true });

  // Collapse user-controlled frontmatter scalars to one physical line.
  const toScalar = (value: unknown): string =>
    typeof value === "string"
      ? [...value.replace(/\s+/g, " ")]
          .filter((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint >= 32 && codePoint !== 127;
          })
          .join("")
          .replace(/"/g, "'")
          .trim()
      : "";

  // Parse attendees
  const attendeesRaw = typeof body.attendees === "string" ? body.attendees : "";
  const attendees = attendeesRaw.split(",").map(toScalar).filter(Boolean);

  // Duration
  const durationSec =
    typeof body.durationSec === "number" &&
    Number.isFinite(body.durationSec) &&
    body.durationSec >= 0
      ? body.durationSec
      : null;
  const durationStr = durationSec != null ? `${Math.round(durationSec / 60)} min` : "";

  // Audio ref
  const rawAudioPath = typeof body.audioPath === "string" ? body.audioPath : "";
  const normalizedAudioPath = rawAudioPath ? normalizeVaultReadPath(rawAudioPath) : "";
  if (
    rawAudioPath &&
    !normalizedAudioPath?.replaceAll(path.sep, "/").startsWith("inbox/meetings/audio/")
  ) {
    return NextResponse.json({ error: "Invalid `audioPath`" }, { status: 400 });
  }
  const audioPath = normalizedAudioPath ? normalizedAudioPath.replaceAll(path.sep, "/") : "";

  // Calendar event ref
  const calendarEventId = toScalar(body.calendarEventId);

  // Title + summary (from AI processing or user edit). Collapse to single-line
  // YAML-safe scalars — the ingest frontmatter parser is line-based.
  const summary = toScalar(body.summary);

  const rawSignals =
    body.signals && typeof body.signals === "object"
      ? (body.signals as Record<string, unknown>)
      : {};
  let signalsForFingerprint: ReturnType<typeof coerceMeetingSignals>;
  try {
    signalsForFingerprint = coerceMeetingSignals({
      ...rawSignals,
      meetingId,
      reviewedAt: "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_meeting_signals";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const payloadHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        meetingId,
        transcript: transcript.trim(),
        slug: baseSlug,
        title: toScalar(body.title),
        summary,
        attendees,
        durationSec,
        audioPath,
        calendarEventId,
        signals: signalsForFingerprint,
      }),
      "utf8",
    )
    .digest("hex");

  // Serialize replay detection and creation by immutable capture identity.
  // Without this lock, two processes could both miss the same meeting ID and
  // create distinct files under different suffixes.
  return withVaultLocks(locateVault(), [`capture:meeting:${meetingId}`], async () => {
    // A replay of the same capture must return the same durable source. A
    // different payload under the same identity is an explicit revision conflict
    // rather than a silently duplicated meeting.
    const existingEntries = await fs.readdir(meetingsDir).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
      throw error;
    });
    for (const filename of existingEntries) {
      if (!filename.endsWith(".md")) continue;
      const existingPath = path.join(meetingsDir, filename);
      const existing = await fs.readFile(existingPath, "utf8").catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
      });
      if (!new RegExp(`^meeting_id:\\s*${meetingId}\\s*$`, "m").test(existing)) continue;
      const existingHash = /^payload_hash:\s*([a-f0-9]{64})$/m.exec(existing)?.[1];
      const relPath = path.join("inbox", "meetings", filename);
      const existingSlug = filename.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
      if (existingHash === payloadHash) {
        return NextResponse.json({
          path: relPath,
          slug: existingSlug,
          meetingId,
          ingestUrl: `/api/ingest/meeting?path=${encodeURIComponent(relPath)}`,
          deduplicated: true,
        });
      }
      return NextResponse.json(
        {
          error: "capture_revision_conflict",
          message: "This meeting capture already exists with different reviewed content.",
          path: relPath,
          meetingId,
        },
        { status: 409 },
      );
    }

    const signals = { ...signalsForFingerprint, reviewedAt: isoTimestamp };
    const encodedSignals = encodeMeetingSignals(signals);

    const buildContent = (resolvedSlug: string): string => {
      const title = toScalar(body.title) || resolvedSlug;
      const frontmatter = [
        "---",
        `type: meeting-source`,
        `meeting_id: ${meetingId}`,
        `payload_hash: ${payloadHash}`,
        `robin_signals: ${encodedSignals}`,
        `date: ${isoDate}`,
        `title: "${title}"`,
        summary ? `summary: "${summary}"` : null,
        attendees.length
          ? `attendees: [${attendees.map((attendee) => JSON.stringify(attendee)).join(", ")}]`
          : null,
        durationStr ? `duration: "${durationStr}"` : null,
        audioPath ? `audio: ${JSON.stringify(audioPath)}` : null,
        calendarEventId ? `calendar_event_id: ${JSON.stringify(calendarEventId)}` : null,
        `updated: ${isoTimestamp}`,
        "---",
      ]
        .filter((line) => line !== null)
        .join("\n");
      return `${frontmatter}\n\n${transcript.trim()}\n`;
    };

    // Resolve a non-colliding filename and write with flag:'wx' (fail-if-exists)
    // so we never silently overwrite. The wx write is the real guard for the race
    // between the access() probe and this write — but a lost race (EEXIST) must be
    // RETRIED under a fresh suffix, not surfaced as a 500 that drops the transcript.
    let relPath = "";
    let slug = "";
    let wrote = false;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5 && !wrote; attempt++) {
      const resolved = await resolveFreeName(meetingsDir, isoDate, baseSlug);
      const absPath = path.join(meetingsDir, resolved.filename);
      try {
        await durableWriteNew(absPath, buildContent(resolved.slug));
        relPath = path.join("inbox", "meetings", resolved.filename);
        slug = resolved.slug;
        wrote = true;
      } catch (err) {
        lastErr = err;
        // A same-second same-slug racing write won the name: re-resolve + retry.
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        // Any other error is fatal.
        return NextResponse.json(
          { error: "Failed to write meeting file", detail: String(err) },
          { status: 500 },
        );
      }
    }

    if (!wrote) {
      return NextResponse.json(
        { error: "Failed to write meeting file", detail: String(lastErr) },
        { status: 500 },
      );
    }

    // Ingest URL (real implementation in /api/ingest/meeting + ingest-meeting skill)
    const ingestUrl = `/api/ingest/meeting?path=${encodeURIComponent(relPath)}`;

    return NextResponse.json({ path: relPath, slug, meetingId, ingestUrl, deduplicated: false });
  });
}
