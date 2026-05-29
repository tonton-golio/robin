/**
 * GET /api/meeting/native/status — UNWIRED FUTURE HELPER (not reachable from UI).
 *
 * This was scaffolded for an optional native "Meeting Recorder.app" path that
 * would capture true system audio (Zoom/Teams desktop apps) and import its
 * markdown exports into the vault. As of 2026-05-29 nothing in the UI calls
 * this route or its sibling `native/import` — the shipping recorder is the
 * browser-based LiveRecorder (mic + shared *tab* audio).
 *
 * Kept (not deleted) because it's a working, security-reviewed import helper
 * we intend to wire up later. If you remove the native path entirely, delete
 * this directory too. Do not assume it runs in production today.
 */

import { NextResponse } from 'next/server';
import fs from 'fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_APP_PATH = '/Applications/Meeting Recorder.app';

export async function GET(): Promise<NextResponse> {
  const appPath = process.env['MEETING_RECORDER_APP_PATH'] ?? DEFAULT_APP_PATH;
  const helperUrl = process.env['MEETING_RECORDER_HELPER_URL'];

  let appInstalled = false;
  try {
    await fs.access(appPath);
    appInstalled = true;
  } catch {
    appInstalled = false;
  }

  const note = helperUrl
    ? 'Helper URL configured. Live relay not yet implemented — use file-based import below.'
    : appInstalled
      ? 'Meeting Recorder.app detected. Use it for system audio (Zoom etc.), diarization, and speaker identification. Export to ~/.meeting-recorder/meetings/ then import here.'
      : 'Browser Recorder is mic-only. For system audio + high-quality speaker diarization, use the native Meeting Recorder app (installed separately) or set MEETING_RECORDER_APP_PATH / MEETING_RECORDER_HOME.';

  return NextResponse.json({
    nativeCapture: {
      status: helperUrl ? 'helper_configured' : appInstalled ? 'app_installed' : 'not_available',
      appPath,
      helperUrl: helperUrl ?? null,
      supportsSystemAudio: appInstalled || Boolean(helperUrl),
      note,
    },
  });
}
