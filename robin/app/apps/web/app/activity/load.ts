/**
 * Activity page — server-side data loader.
 *
 * Reads the append-only streams the Robin agent writes (edit log, annotation
 * log, daily-session pages, ingest log) straight off the filesystem and maps
 * them into the flat, serializable {@link ActivityData} the client lenses
 * render. No new server API is introduced — this composes the existing read
 * libs (edit-store, annotation-store, catalog) plus a tolerant ingest-log
 * parser and a raw parse-health pass so damaged JSONL is surfaced, never
 * silently skipped.
 *
 * NOTE (reported to foundation): a month-windowed `GET /api/edits?month=` and a
 * durable lastSeen sidecar endpoint do not exist yet; until they do this loads
 * the full edit stream and the client windows it by month, and the seen
 * watermark lives in localStorage. See the agent report.
 */

import 'server-only';
import fs from 'fs/promises';
import path from 'path';
import { listEdits, editLogDir, type EditRecord } from '@/lib/edit-store';
import { listAnnotations, annotationLogDir } from '@/lib/annotation-store';
import { annotationEventTimestamp } from '@/lib/annotations';
import { listDailyLogs } from '@/lib/catalog';
import { vaultFileHref, vaultPageHref } from '@/lib/routes';
import { locateVault } from '@/lib/vault';
import type {
  ActivityData,
  ArtifactKind,
  CommentRow,
  LedgerEvent,
  LedgerKind,
  LedgerOrigin,
  ParseHealth,
} from './model';

const KIND_MAP: Record<string, LedgerKind> = {
  'edit.created': 'created',
  'edit.saved': 'edited',
  'edit.reverted': 'reverted',
  'edit.deleted': 'deleted',
};

function mapOrigin(origin: string, actor?: string): LedgerOrigin {
  // web edits are human unless the actor explicitly says robin; every other
  // origin (mcp/agent/cli) is the agent. Provenance detail (web vs mcp) is kept
  // in originRaw and never becomes a third identity.
  if (origin === 'web') return actor?.toLowerCase() === 'robin' ? 'robin' : 'human';
  return 'robin';
}

function mapArtifact(edit: EditRecord): ArtifactKind {
  if (edit.kind === 'deck') return 'deck';
  if (edit.kind === 'task' || edit.page_path.includes('/tasks/')) return 'task';
  if (edit.page_path.endsWith('.html')) return 'page';
  return 'other';
}

function titleFor(edit: EditRecord): string {
  if (edit.title) return edit.title;
  const leaf = edit.page_path.split('/').pop() ?? edit.page_path;
  return leaf.replace(/\.html$/i, '').replace(/[-_]+/g, ' ');
}

function editToLedger(edit: EditRecord): LedgerEvent {
  return {
    id: edit.id,
    ts: edit.ts,
    origin: mapOrigin(edit.origin, edit.actor),
    originRaw: edit.origin,
    tool: edit.tool ?? undefined,
    kind: KIND_MAP[edit.event] ?? 'edited',
    artifactKind: mapArtifact(edit),
    path: edit.page_path,
    title: titleFor(edit),
    summary: edit.summary,
    beforeHash: edit.before_hash,
    afterHash: edit.after_hash,
    added: edit.diff_stat?.added ?? 0,
    removed: edit.diff_stat?.removed ?? 0,
    hasSnapshot: Boolean(edit.snapshot),
  };
}

/** Compute JSONL parse health over the newest edit-log file (raw pass). */
async function editParseHealth(vault: string): Promise<ParseHealth> {
  const dir = path.join(vault, editLogDir());
  let files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => e.name)
      .sort();
  } catch {
    return { linesTotal: 0, linesSkipped: 0, firstBadLine: null, file: null };
  }
  const newest = files[files.length - 1];
  if (!newest) return { linesTotal: 0, linesSkipped: 0, firstBadLine: null, file: null };

  let total = 0;
  let skipped = 0;
  let firstBad: number | null = null;
  const content = await fs.readFile(path.join(dir, newest), 'utf-8').catch(() => '');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    total += 1;
    try {
      JSON.parse(line);
    } catch {
      skipped += 1;
      if (firstBad === null) firstBad = i + 1;
    }
  }
  return {
    linesTotal: total,
    linesSkipped: skipped,
    firstBadLine: firstBad,
    file: path.join(editLogDir(), newest),
  };
}

const INGEST_HEAD_RE = /^##\s*\[(\d{4}-\d{2}-\d{2})\]\s*([^|]+?)\s*\|\s*(.+)$/;
const INGEST_SRC_RE = /\*\*Source\*\*:\s*`([^`]+)`/i;

/** Tolerant parser for logs/ingest-log.md — one ledger row per `## [date]` block. */
async function loadIngest(vault: string): Promise<LedgerEvent[]> {
  const raw = await fs.readFile(path.join(vault, 'logs', 'ingest-log.md'), 'utf-8').catch(() => '');
  if (!raw) return [];
  const out: LedgerEvent[] = [];
  const blocks = raw.split(/\n(?=##\s*\[)/);
  let idx = 0;
  for (const block of blocks) {
    const firstLine = block.split('\n', 1)[0] ?? '';
    const m = INGEST_HEAD_RE.exec(firstLine.trim());
    if (!m) continue;
    const [, date, categoryRaw, title] = m;
    const category = categoryRaw!.trim();
    const src = INGEST_SRC_RE.exec(block)?.[1];
    // First body bullet as a one-line summary.
    const bullet = block
      .split('\n')
      .find((l) => l.trim().startsWith('- '))
      ?.replace(/^\s*-\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .slice(0, 240);
    idx += 1;
    out.push({
      id: `ingest-${date}-${idx}`,
      ts: `${date}T12:00:00`,
      origin: 'robin',
      originRaw: 'agent',
      tool: `/${category.split(/\s+/)[0] || 'ingest'}`,
      kind: 'ingest',
      artifactKind: 'other',
      path: '',
      title: title!.trim(),
      summary: bullet,
      added: 0,
      removed: 0,
      hasSnapshot: false,
      ...(src ? { src } : {}),
    });
  }
  return out;
}

function commentLocation(a: {
  pin?: { slide: number } | undefined;
  anchor?: { text_quote?: { exact?: string } } | undefined;
}): string {
  if (a.pin) return `slide ${a.pin.slide + 1} · pin`;
  if (a.anchor?.text_quote?.exact) return 'text · pin';
  return 'page note';
}

export async function loadActivity(): Promise<ActivityData> {
  const empty: ActivityData = {
    edits: [],
    comments: [],
    sessions: [],
    liveSession: null,
    health: { linesTotal: 0, linesSkipped: 0, firstBadLine: null, file: null },
    logMeta: { editsFile: '', editsCount: 0, annFile: '', annCount: 0 },
    rawLinks: [],
  };

  try {
    const vault = locateVault();
    const [editRecords, annotations, dailyLogs, ingest, health] = await Promise.all([
      listEdits(),
      listAnnotations({ includeClosed: true }),
      listDailyLogs(),
      loadIngest(vault),
      editParseHealth(vault),
    ]);

    const edits: LedgerEvent[] = [...editRecords.map(editToLedger), ...ingest].sort((a, b) =>
      b.ts.localeCompare(a.ts),
    );

    const comments: CommentRow[] = annotations.map((a): CommentRow => {
      const p = a.page_path ?? a.render_path ?? '';
      const leaf = p.split('/').pop() ?? p;
      const shortId = a.id?.replace(/^ann_/, '').slice(0, 4);
      return {
        id: a.id,
        status: a.status,
        kind: a.kind === 'highlight' ? 'highlight' : 'comment',
        path: p,
        title: leaf.replace(/\.html$/i, '').replace(/[-_]+/g, ' '),
        location: `${commentLocation(a)}${shortId ? ` · #${shortId}` : ''}`,
        text: a.comment_md,
        quote: a.anchor?.text_quote?.exact,
        resolutionMd: a.resolution_md,
        resultLink: a.result_link,
        ts: annotationEventTimestamp(a),
        pageChanged: a.pageChanged,
        pageHref: p.endsWith('.html') ? vaultPageHref(p) : null,
        origin: a.author?.toLowerCase() === 'robin' ? 'robin' : 'human',
        author: a.author,
      };
    });

    const sessions = dailyLogs.map((d) => ({
      date: d.date,
      title: d.title,
      summary: d.summary,
      sessions: d.sessions,
      outcomes: d.outcomes.slice(0, 4),
      href: d.href,
    }));

    // Capture-in-progress lock (best-effort).
    let liveSession: ActivityData['liveSession'] = null;
    try {
      const lock = await fs.readFile(path.join(vault, '.robin', 'session.lock'), 'utf-8');
      const parsed = (() => {
        try {
          return JSON.parse(lock) as { pid?: string | number; log?: string };
        } catch {
          return { pid: lock.trim() };
        }
      })();
      liveSession = { pid: parsed.pid ? String(parsed.pid) : undefined, log: parsed.log };
    } catch {
      liveSession = null;
    }

    const editsFile = health.file ?? path.join(editLogDir(), 'current.jsonl');
    const rawLinks = [
      { label: editsFile.replace(/^inbox\/robin\//, ''), href: vaultFileHref(editsFile) },
      { label: `${annotationLogDir()}/`, href: vaultFileHref(annotationLogDir()) },
      { label: 'logs/ingest-log.md', href: vaultFileHref('logs/ingest-log.md') },
    ];

    return {
      edits,
      comments,
      sessions,
      liveSession,
      health,
      logMeta: {
        editsFile,
        editsCount: editRecords.length,
        annFile: annotationLogDir(),
        annCount: annotations.length,
      },
      rawLinks,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}
