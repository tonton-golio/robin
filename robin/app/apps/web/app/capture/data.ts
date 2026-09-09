/**
 * Server-only data loader for the Capture page.
 *
 * Reads the capture pipeline directly off the vault filesystem — no new API
 * route needed (the page is an RSC). Sources, all vault-relative:
 *   · inbox/meetings/ *.md            → raw meetings   (writer: meeting-widget)
 *   · inbox/interviews/ *.md          → raw interviews (writer: interview-widget)
 *   · logs/meetings/ *.html           → ingested meetings   (writer: robin)
 *   · logs/interviews/ *.html         → ingested interviews (writer: robin)
 *   · inbox/meetings/audio/ *.partial.txt → crash checkpoints (recovery)
 *   · logs/interviews/.live/ *        → interrupted interviews (recovery)
 *   · inbox/meetings/audio/ *.webm    → stranded audio, no transcript (recovery)
 *
 * Provenance strings are the human-visible mirror of the ingest audit trail:
 * raw rows carry the widget author; ingested rows carry `robin · ingest-*`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { locateVault } from '@/lib/vault';
import { vaultPageHref, vaultApiFileHref } from '@/lib/routes';
import type {
  CaptureData,
  CaptureSession,
  CaptureStats,
  RecoveryItem,
} from './types';

/** Inbox backlog above this reads as "ingest fell behind" (overloaded). */
const BACKLOG_ALARM = 12;
/** Cap on stranded-audio rows so an old audio archive can't flood the lane. */
const STRANDED_AUDIO_CAP = 6;

// ── small filesystem helpers ────────────────────────────────────────────────

interface Entry {
  name: string;
  rel: string;
  abs: string;
  mtimeMs: number;
}

async function listFiles(vault: string, relDir: string): Promise<Entry[]> {
  const abs = path.join(/*turbopackIgnore: true*/ vault, relDir);
  let names: string[];
  try {
    names = await fs.readdir(abs);
  } catch {
    return [];
  }
  const out: Entry[] = [];
  for (const name of names) {
    if (name.startsWith('.') || name.startsWith('_')) continue;
    const fileAbs = path.join(/*turbopackIgnore: true*/ abs, name);
    let stat;
    try {
      stat = await fs.stat(fileAbs);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    out.push({ name, rel: `${relDir}/${name}`, abs: fileAbs, mtimeMs: stat.mtimeMs });
  }
  return out;
}

async function readText(abs: string): Promise<string> {
  try {
    return await fs.readFile(abs, 'utf-8');
  } catch {
    return '';
  }
}

// ── metadata parsing ────────────────────────────────────────────────────────

function metaContent(html: string, name: string): string | undefined {
  const re = new RegExp(
    `<meta\\s+name=["']${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}["']\\s+content=["']([^"']*)["']`,
    'i',
  );
  return re.exec(html)?.[1];
}

function metaAll(html: string, name: string): string[] {
  const re = new RegExp(
    `<meta\\s+name=["']${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}["']\\s+content=["']([^"']*)["']`,
    'gi',
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(decodeEntities(m[1]!));
  return out;
}

function titleTag(html: string): string | undefined {
  return decodeEntities(/<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? '');
}

function decodeEntities(v: string): string {
  return v
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** First N chars of the article body (or raw md), as a plain-text excerpt. */
function bodyExcerpt(raw: string, isHtml: boolean, max = 320): string {
  let text: string;
  if (isHtml) {
    const body = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(raw)?.[1] ?? raw;
    text = stripTags(body);
  } else {
    text = raw
      .replace(/^---[\s\S]*?\n---\n/, '') // frontmatter
      .replace(/^#.*$/gm, '') // headings
      .replace(/[*_`>#-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

// ── raw markdown frontmatter (meeting saves) ────────────────────────────────

function parseMdFrontmatter(md: string): { title?: string; date?: string; attendees: string[]; summary?: string } {
  const attendees: string[] = [];
  let title: string | undefined;
  let date: string | undefined;
  let summary: string | undefined;
  if (md.startsWith('---\n')) {
    const end = md.indexOf('\n---', 4);
    if (end !== -1) {
      for (const line of md.slice(4, end).split('\n')) {
        const i = line.indexOf(':');
        if (i === -1) continue;
        const key = line.slice(0, i).trim();
        const val = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        if (key === 'title') title = val;
        else if (key === 'date') date = val;
        else if (key === 'summary') summary = val;
        else if (key === 'attendees')
          attendees.push(
            ...val
              .replace(/^\[|\]$/g, '')
              .split(',')
              .map((a) => a.trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean),
          );
      }
    }
  }
  if (!title) {
    const h = /^#\s+(.+)$/m.exec(md);
    if (h) title = h[1]!.trim();
  }
  return { title, date, attendees, summary };
}

// ── display helpers ─────────────────────────────────────────────────────────

function humanizeSlug(slug: string): string {
  return slug
    .replace(/\.(md|html|partial\.txt)$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}[-T]?/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function whenLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toTimeString().slice(0, 5);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days >= 1 && days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase();
}

function relativeAge(iso: string, now: Date): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '—';
  const mins = Math.max(0, Math.round((now.getTime() - d) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── main loader ─────────────────────────────────────────────────────────────

export async function loadCaptures(): Promise<CaptureData> {
  const now = new Date();
  let vault: string;
  try {
    vault = locateVault();
  } catch (err) {
    return { sessions: [], recovery: [], stats: emptyStats(), error: String(err) };
  }

  try {
    const [rawMeetings, rawInterviews, ingMeetings, ingInterviews, audio] = await Promise.all([
      listFiles(vault, 'inbox/meetings'),
      listFiles(vault, 'inbox/interviews'),
      listFiles(vault, 'logs/meetings'),
      listFiles(vault, 'logs/interviews'),
      listFiles(vault, 'inbox/meetings/audio'),
    ]);

    const sessions: CaptureSession[] = [];

    // Raw meetings (inbox/meetings/*.md) — captured, not yet ingested.
    for (const e of rawMeetings) {
      if (!e.name.endsWith('.md')) continue;
      const md = await readText(e.abs);
      const fm = parseMdFrontmatter(md);
      const when = fm.date ? isoOrMtime(fm.date, e.mtimeMs) : new Date(e.mtimeMs).toISOString();
      sessions.push({
        id: e.rel,
        kind: 'meeting',
        status: 'raw',
        title: fm.title || humanizeSlug(e.name) || 'Untitled meeting',
        sourcePath: e.rel,
        href: vaultApiFileHref(e.rel),
        writer: { who: 'human', label: 'meeting-widget (human)' },
        when,
        whenLabel: whenLabel(when, now),
        date: fm.date,
        summary: fm.summary,
        attendees: fm.attendees,
        excerpt: bodyExcerpt(md, false),
        ingestPath: e.rel,
        glyph: '◑',
      });
    }

    // Raw interviews (inbox/interviews/*.md).
    for (const e of rawInterviews) {
      if (!e.name.endsWith('.md')) continue;
      const md = await readText(e.abs);
      const fm = parseMdFrontmatter(md);
      const when = new Date(e.mtimeMs).toISOString();
      sessions.push({
        id: e.rel,
        kind: 'interview',
        status: 'raw',
        title: fm.title || humanizeSlug(e.name) || 'Quick interview',
        sourcePath: e.rel,
        href: vaultApiFileHref(e.rel),
        writer: { who: 'human', label: 'interview-widget (human)' },
        when,
        whenLabel: whenLabel(when, now),
        attendees: fm.attendees,
        excerpt: bodyExcerpt(md, false),
        glyph: '●',
      });
    }

    // Ingested meetings (logs/meetings/*.html) — the agent wrote these.
    const referencedSources = new Set<string>();
    for (const e of ingMeetings) {
      if (!e.name.endsWith('.html')) continue;
      const html = await readText(e.abs);
      for (const s of metaAll(html, 'robin:source')) referencedSources.add(s);
      const when = isoOrMtime(metaContent(html, 'robin:updated'), e.mtimeMs);
      sessions.push({
        id: e.rel,
        kind: 'meeting',
        status: 'ingested',
        title: titleTag(html) || metaContent(html, 'robin:slug') || humanizeSlug(e.name),
        sourcePath: e.rel,
        pagePath: e.rel,
        href: vaultPageHref(e.rel),
        writer: { who: 'robin', label: 'robin · ingest-meeting' },
        when,
        whenLabel: whenLabel(when, now),
        date: metaContent(html, 'robin:date'),
        summary: metaContent(html, 'robin:summary'),
        attendees: metaAll(html, 'robin:attendee'),
        excerpt: bodyExcerpt(html, true),
        glyph: '◍',
      });
    }

    // Ingested interviews (logs/interviews/*.html).
    for (const e of ingInterviews) {
      if (!e.name.endsWith('.html')) continue;
      const html = await readText(e.abs);
      const when = isoOrMtime(metaContent(html, 'robin:updated'), e.mtimeMs);
      sessions.push({
        id: e.rel,
        kind: 'interview',
        status: 'ingested',
        title: titleTag(html) || metaContent(html, 'robin:slug') || humanizeSlug(e.name),
        sourcePath: e.rel,
        pagePath: e.rel,
        href: vaultPageHref(e.rel),
        writer: { who: 'robin', label: 'robin · ingest-interview' },
        when,
        whenLabel: whenLabel(when, now),
        date: metaContent(html, 'robin:date'),
        summary: metaContent(html, 'robin:summary'),
        attendees: metaAll(html, 'robin:attendee'),
        excerpt: bodyExcerpt(html, true),
        glyph: '◍',
      });
    }

    sessions.sort((a, b) => b.when.localeCompare(a.when));

    // ── recovery lane ──────────────────────────────────────────────────────
    const recovery: RecoveryItem[] = [];

    // Crash checkpoints (*.partial.txt) — genuine interruptions.
    for (const e of audio) {
      if (!e.name.endsWith('.partial.txt')) continue;
      const txt = await readText(e.abs);
      const elapsed = /# elapsed:\s*(\d+)s/.exec(txt)?.[1];
      const lines = txt.replace(/^#.*$/gm, '').trim();
      recovery.push({
        id: e.rel,
        kind: 'checkpoint',
        title: `${humanizeSlug(e.name.replace('.partial.txt', ''))} — draft`,
        sourcePath: e.rel,
        detail: `localStorage/server checkpoint · ${
          elapsed ? `${Math.round(Number(elapsed) / 60)}m buffered` : `${lines.length} chars buffered`
        } · interrupted before Stop & review`,
        warn: true,
        glyph: '◑',
        when: new Date(e.mtimeMs).toISOString(),
        href: vaultApiFileHref(e.rel),
      });
    }

    // Interrupted interviews (logs/interviews/.live/*).
    for (const e of await listFilesIncludingDot(vault, 'logs/interviews/.live')) {
      recovery.push({
        id: e.rel,
        kind: 'live-interview',
        title: `${humanizeSlug(e.name)} — interview partial`,
        sourcePath: e.rel,
        detail: `logs/interviews/.live · autosaved · connection dropped before End interview`,
        warn: false,
        glyph: '●',
        when: new Date(e.mtimeMs).toISOString(),
        href: vaultApiFileHref(e.rel),
      });
    }

    // Stranded audio (*.webm never transcribed) — capped so old archives don't flood.
    const stranded = audio
      .filter((e) => /\.(webm|m4a|mp3|wav|ogg)$/i.test(e.name) && !referencedSources.has(e.rel))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, STRANDED_AUDIO_CAP);
    for (const e of stranded) {
      recovery.push({
        id: e.rel,
        kind: 'audio',
        title: e.name,
        sourcePath: e.rel,
        detail: `inbox/meetings/audio · no transcript · dropped in by hand, never processed`,
        warn: false,
        glyph: '♪',
        when: new Date(e.mtimeMs).toISOString(),
        href: vaultApiFileHref(e.rel),
      });
    }

    recovery.sort((a, b) => b.when.localeCompare(a.when));

    // ── stats / freshness ────────────────────────────────────────────────────
    const inboxRaw = sessions.filter((s) => s.status === 'raw').length;
    const lastIngest = sessions.find((s) => s.status === 'ingested');
    const stats: CaptureStats = {
      unfinished: recovery.length,
      inboxRaw,
      lastIngestIso: lastIngest?.when,
      lastIngestLabel: lastIngest ? relativeAge(lastIngest.when, now) : '—',
      degraded: inboxRaw >= BACKLOG_ALARM,
    };

    return { sessions, recovery, stats };
  } catch (err) {
    return { sessions: [], recovery: [], stats: emptyStats(), error: String(err) };
  }
}

async function listFilesIncludingDot(vault: string, relDir: string): Promise<Entry[]> {
  const abs = path.join(/*turbopackIgnore: true*/ vault, relDir);
  let names: string[];
  try {
    names = await fs.readdir(abs);
  } catch {
    return [];
  }
  const out: Entry[] = [];
  for (const name of names) {
    if (name === '.' || name === '..') continue;
    const fileAbs = path.join(/*turbopackIgnore: true*/ abs, name);
    try {
      const stat = await fs.stat(fileAbs);
      if (stat.isFile()) out.push({ name, rel: `${relDir}/${name}`, abs: fileAbs, mtimeMs: stat.mtimeMs });
    } catch {
      /* skip */
    }
  }
  return out;
}

function isoOrMtime(value: string | undefined, mtimeMs: number): string {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date(mtimeMs).toISOString();
}

function emptyStats(): CaptureStats {
  return { unfinished: 0, inboxRaw: 0, lastIngestLabel: '—', degraded: false };
}
