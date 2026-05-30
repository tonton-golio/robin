/**
 * GET/POST /api/meeting/native/{import} — UNWIRED FUTURE HELPER (not reachable
 * from UI). Lists and imports markdown+audio exports produced by an optional
 * native "Meeting Recorder.app" (true system-audio capture for Zoom/Teams
 * desktop apps). As of 2026-05-29 no UI calls this route; the shipping recorder
 * is the browser-based LiveRecorder.
 *
 * Kept (not deleted) because the import path is implemented and security-
 * reviewed (path-traversal guarded, bare-filename audio refs only) and we
 * intend to wire it up later. If the native path is dropped entirely, delete
 * this directory. Do not assume it runs in production today.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { vaultPath } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function meetingRecorderHome(): string {
  return process.env['MEETING_RECORDER_HOME'] ?? path.join(os.homedir(), '.meeting-recorder');
}

function recordingsDir(): string {
  return path.join(meetingRecorderHome(), 'recordings');
}

function slugifyFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

/**
 * Lightweight YAML frontmatter parser for native Meeting Recorder exports.
 * Supports the observed format (date, title, duration, speakers array, audio_file).
 */
function parseNativeFrontmatter(markdown: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!markdown.startsWith('---')) return result;
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return result;
  const fm = markdown.slice(4, end);
  for (const line of fm.split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    const key = (m[1] ?? '').trim();
    let val = (m[2] ?? '').trim();
    // Strip surrounding quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Handle simple array for speakers (take raw for display)
    result[key] = val;
  }
  return result;
}

async function listNativeCandidates(limit = 20): Promise<any[]> {
  const meetingsRoot = path.resolve(meetingRecorderHome(), 'meetings');
  const recRoot = recordingsDir();
  let files: string[] = [];
  try {
    const dirents = await fs.readdir(meetingsRoot, { withFileTypes: true });
    files = dirents
      .filter(d => d.isFile() && d.name.endsWith('.md'))
      .map(d => path.join(meetingsRoot, d.name));
  } catch {
    return [];
  }

  // Sort by mtime desc (newest first)
  const withStats = await Promise.all(
    files.map(async (p) => {
      try {
        const st = await fs.stat(p);
        return { p, mtime: st.mtimeMs };
      } catch {
        return { p, mtime: 0 };
      }
    })
  );
  withStats.sort((a, b) => b.mtime - a.mtime);

  const candidates: any[] = [];
  for (const { p } of withStats.slice(0, limit)) {
    let content = '';
    try { content = await fs.readFile(p, 'utf-8'); } catch { continue; }
    const fm = parseNativeFrontmatter(content);
    const base = path.basename(p);
    const audioRef = fm['audio_file'] || '';
    let hasAudio = false;
    let audioSize = 0;
    if (audioRef) {
      const audioCandidate = path.join(recRoot, audioRef);
      try {
        const st = await fs.stat(audioCandidate);
        hasAudio = st.isFile();
        audioSize = st.size;
      } catch {}
    }
    candidates.push({
      path: p,
      filename: base,
      title: fm['title'] || base.replace(/\.md$/, ''),
      date: fm['date'] || '',
      duration: fm['duration'] || '',
      speakers: fm['speakers'] || '',
      audio_file: audioRef,
      hasAudio,
      audioSize,
    });
  }
  return candidates;
}

async function importNativeRecording(sourceMdPath: string): Promise<any> {
  const sourceRoot = path.resolve(meetingRecorderHome(), 'meetings');
  const recRoot = recordingsDir();
  const absSource = path.resolve(sourceMdPath);

  if (absSource !== sourceRoot && !absSource.startsWith(sourceRoot + path.sep)) {
    throw new Error('Path must be inside Meeting Recorder meetings directory');
  }
  if (path.extname(absSource) !== '.md') {
    throw new Error('Only markdown meeting exports can be imported');
  }

  let markdown: string;
  try {
    markdown = await fs.readFile(absSource, 'utf-8');
  } catch {
    throw new Error('Meeting export not found');
  }

  const fm = parseNativeFrontmatter(markdown);
  const audioRef = (fm['audio_file'] || '').trim();

  // Copy the markdown
  const base = slugifyFilename(path.basename(absSource)) || 'native-meeting';
  const filename = `${base}.md`;
  const relMdPath = `inbox/meetings/${filename}`;
  const destMd = vaultPath(relMdPath);
  await fs.mkdir(path.dirname(destMd), { recursive: true });
  await fs.writeFile(destMd, markdown, 'utf-8');

  // Copy audio if referenced and present. `audioRef` comes from untrusted
  // frontmatter — it must be a bare filename, never a path. Reject anything
  // with directory separators or `..` so a crafted export can't read/write
  // outside the recordings dir / vault audio dir.
  let importedAudio: string | null = null;
  if (audioRef && (audioRef.includes('/') || audioRef.includes('\\') || audioRef.includes('..') || audioRef.includes('\0'))) {
    throw new Error('audio_file must be a bare filename');
  }
  if (audioRef) {
    const srcAudio = path.join(recRoot, audioRef);
    try {
      await fs.access(srcAudio);
      const audioDir = vaultPath('inbox', 'meetings', 'audio');
      await fs.mkdir(audioDir, { recursive: true });
      const destAudio = path.join(audioDir, audioRef);
      await fs.copyFile(srcAudio, destAudio);
      importedAudio = path.join('inbox', 'meetings', 'audio', audioRef);
    } catch {
      // audio missing or inaccessible — non-fatal for the md import
    }
  }

  const ingestUrl = `/api/ingest/meeting?path=${encodeURIComponent(relMdPath)}`;

  return {
    ok: true,
    sourcePath: absSource,
    importedPath: relMdPath,
    importedAudioPath: importedAudio,
    hasAudio: !!importedAudio,
    ingestUrl,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '20', 10)));
  try {
    const candidates = await listNativeCandidates(limit);
    return NextResponse.json({ candidates });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to list native meetings', detail: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { path?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.path !== 'string' || !body.path.trim()) {
    return NextResponse.json({ error: '`path` is required' }, { status: 400 });
  }

  try {
    const result = await importNativeRecording(body.path as string);
    return NextResponse.json(result);
  } catch (err: any) {
    const msg = err?.message || 'Import failed';
    const status = msg.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
