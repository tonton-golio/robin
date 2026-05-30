import fs from 'fs/promises';
import path from 'path';
import { locateVault } from '@/lib/vault';
import { listBrainPages, type CatalogPage, pageHref } from '@/lib/catalog';
import { loadCalendarToday, type CalendarTodayEvent } from '@/lib/calendar';
import { vaultFileHref } from '@/lib/routes';
import { listTasks, type TaskItem } from '@/lib/tasks';

export interface TodayBullet {
  text: string;
  tone?: 'amber' | 'cyan' | 'violet' | 'rust' | 'muted';
  href?: string;
}

export interface InboxItem {
  path: string;
  href: string;
  title: string;
  age: string;
}

export interface OpenThread {
  title: string;
  href: string;
  age: string;
}

export interface TopTask {
  title: string;
  href: string;
  state: string;
  priority?: string;
  due?: string;
  owner?: string;
}

export interface TodaySnapshot {
  date: Date;
  dateLabel: string;
  brief: TodayBullet[];
  briefUpdatedAt?: string;
  inbox: InboxItem[];
  openThreads: OpenThread[];
  topTasks: TopTask[];
  stats: { pages: number; tasks: number; decisions: number; outputs: number };
  meetingsToday: number;
  calendar: {
    available: boolean;
    events: CalendarTodayEvent[];
    generatedAt?: string;
  };
}

// Sources that arrive as discrete files needing an ingest pass. Annotation
// streams are deliberately excluded: they are append-only .jsonl logs with
// their own resolution flow (see lib/annotations.ts), not single sources to
// ingest, so they would otherwise stick in this card forever and the count
// could never reach zero ("Inbox clear.").
const INBOX_DIRS = [
  { dir: 'inbox/meetings', label: 'meeting' },
  { dir: 'inbox/interviews', label: 'interview' },
];

function ageOf(date: Date): string {
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function looksLikeReadme(name: string): boolean {
  return /^_?readme/i.test(name) || /^_index/.test(name);
}

async function gatherInbox(vault: string): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  for (const { dir, label } of INBOX_DIRS) {
    try {
      const entries = await fs.readdir(path.join(vault, dir), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'archived' || looksLikeReadme(entry.name)) continue;
        // Skip append-only stream logs (e.g. .jsonl) — they are never "done
        // ingesting", so they don't belong in a clearable inbox-zero list.
        if (/\.jsonl$/i.test(entry.name)) continue;
        if (!entry.isFile() && !entry.isDirectory()) continue;
        const rel = `${dir}/${entry.name}`;
        try {
          const stat = await fs.stat(path.join(vault, rel));
          if (entry.isDirectory()) continue;
          items.push({
            path: rel,
            href: vaultFileHref(rel),
            title: entry.name.replace(/\.(md|txt|jsonl|html)$/i, ''),
            age: ageOf(stat.mtime),
          });
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore missing
    }
  }
  return items.slice(0, 8);
}

// Keep bullets glanceable: synthesis docs (remsleep, weekly-review) carry dense
// multi-sentence prose that otherwise lets the hero card dominate the viewport.
// Prefer the first sentence; hard-cap at ~140 chars with an ellipsis.
function clampBullet(text: string, max = 140): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const sentenceEnd = t.search(/[.!?](?:\s|$)/);
  if (sentenceEnd > 0 && sentenceEnd + 1 <= max) return t.slice(0, sentenceEnd + 1);
  // No early sentence break — cut on a word boundary near the limit.
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

function extractFirstBullets(text: string, max = 5): string[] {
  // Markdown-style reports / handovers: lines starting with -, * or "1.".
  const lines = text.split(/\n/);
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);
    if (m && m[1]) {
      out.push(clampBullet(m[1].trim()));
      if (out.length >= max) break;
    }
  }
  if (out.length > 0) return out;

  // Robin HTML reports (morning-brief / weekly-review / remsleep): pull the
  // first list items, falling back to body paragraphs.
  const listItems = [...text.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => clampBullet(stripHtml(m[1] ?? '')))
    .filter(Boolean);
  if (listItems.length > 0) return listItems.slice(0, max);

  const paragraphs = [...text.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => clampBullet(stripHtml(m[1] ?? '')))
    .filter(Boolean);
  return paragraphs.slice(0, max);
}

async function loadLatestBrief(vault: string): Promise<{ bullets: TodayBullet[]; updated?: string }> {
  // Try the morning-brief / weekly-review reports and the nightly remsleep,
  // then fall back to the latest handover (logs/handovers/).
  const candidates: string[] = [];
  try {
    const reports = await fs.readdir(path.join(vault, 'logs', 'reports')).catch(() => [] as string[]);
    for (const f of reports) {
      if (/morning-brief|weekly-review|brief/i.test(f)) {
        candidates.push(path.join('logs', 'reports', f));
      }
    }
    const remsleep = await fs.readdir(path.join(vault, 'logs', 'remsleep')).catch(() => [] as string[]);
    for (const f of remsleep) {
      if (f.endsWith('.html')) candidates.push(path.join('logs', 'remsleep', f));
    }
  } catch {
    // ignore
  }
  if (candidates.length === 0) {
    try {
      const handovers = await fs.readdir(path.join(vault, 'logs', 'handovers')).catch(() => [] as string[]);
      for (const f of handovers.slice(-3)) {
        if (f.endsWith('.md')) candidates.push(path.join('logs', 'handovers', f));
      }
    } catch {
      // ignore
    }
  }
  // Pick newest
  let newest: { rel: string; mtime: Date } | null = null;
  for (const rel of candidates) {
    try {
      const stat = await fs.stat(path.join(vault, rel));
      if (!newest || stat.mtime > newest.mtime) newest = { rel, mtime: stat.mtime };
    } catch {
      // ignore
    }
  }
  if (!newest) return { bullets: [] };
  try {
    const text = await fs.readFile(path.join(vault, newest.rel), 'utf-8');
    const bullets = extractFirstBullets(text, 5).map<TodayBullet>((b) => ({
      text: stripHtml(b),
      tone: 'cyan',
    }));
    return { bullets, updated: ageOf(newest.mtime) };
  } catch {
    return { bullets: [] };
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).trim();
}

function isOpen(page: CatalogPage): boolean {
  const summary = (page.summary ?? '').toLowerCase();
  if (page.type === 'task' || page.type === 'project' || page.type === 'unknown') {
    if (page.path.includes('/archive/') || page.path.includes('/Trash/')) return false;
    return !/done|completed|closed|archived|retired/.test(summary);
  }
  return false;
}

export async function getTodaySnapshot(): Promise<TodaySnapshot> {
  const vault = locateVault();
  const pages = await listBrainPages();
  const inbox = await gatherInbox(vault);
  const { bullets, updated } = await loadLatestBrief(vault);
  const cal = await loadCalendarToday();

  const tasksCount = pages.filter((p) => p.type === 'task').length;
  const decisionsCount = pages.filter((p) => p.type === 'decision').length;
  let outputs = 0;
  try {
    const outs = await fs.readdir(path.join(vault, 'out'), { recursive: true } as Parameters<typeof fs.readdir>[1]);
    outputs = (outs as unknown as string[]).filter((f: string) => /\.(html|pdf|png|jpg|jpeg|md)$/i.test(f)).length;
  } catch {
    outputs = 0;
  }

  const open = pages
    .filter(isOpen)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, 6)
    .map((p) => ({
      title: p.title,
      href: pageHref(p.path),
      age: ageOf(p.mtime),
    }));

  const allTasks = await listTasks().catch(() => [] as TaskItem[]);
  const topTasks = selectTopTasks(allTasks, 7);

  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return {
    date: now,
    dateLabel,
    brief: bullets,
    briefUpdatedAt: updated,
    inbox,
    openThreads: open,
    topTasks,
    stats: { pages: pages.length, tasks: tasksCount, decisions: decisionsCount, outputs },
    meetingsToday: cal?.events.length ?? 0,
    calendar: {
      available: cal !== null,
      events: cal?.events ?? [],
      generatedAt: cal?.generatedAt,
    },
  };
}

function selectTopTasks(tasks: TaskItem[], max: number): TopTask[] {
  const normState = (s: string) => (s || 'open').toLowerCase().replace(/_/g, '-');
  const prioRank: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3, p4: 4 };

  const tier = (t: TaskItem): number => {
    const st = normState(t.state);
    if (st === 'in-progress' || st === 'in progress') return 0;
    if (st === 'blocked') return 1;
    if (st === 'open') {
      const p = (t.priority || '').toLowerCase();
      if (p === 'p0' || p === 'p1') return 2;
      if (t.due) {
        const d = new Date(t.due).getTime();
        if (!Number.isNaN(d) && d - Date.now() < 1000 * 3600 * 24 * 14) return 3;
      }
      return 4;
    }
    if (st === 'done' || st === 'completed' || st === 'closed' || st === 'archived') return 9;
    return 8;
  };

  // Treat absent OR unparseable due dates as Infinity. A bare `new Date(due)`
  // yields NaN for garbage input, and NaN !== NaN makes the comparator return
  // NaN → an unstable/incorrect sort order.
  const dueMs = (due?: string): number => {
    if (!due) return Infinity;
    const t = new Date(due).getTime();
    return Number.isNaN(t) ? Infinity : t;
  };

  const sorted = [...tasks].sort((a, b) => {
    const ta = tier(a), tb = tier(b);
    if (ta !== tb) return ta - tb;

    const da = dueMs(a.due);
    const db = dueMs(b.due);
    if (da !== db) return da - db;

    const pa = prioRank[(a.priority || 'p9').toLowerCase()] ?? 99;
    const pb = prioRank[(b.priority || 'p9').toLowerCase()] ?? 99;
    if (pa !== pb) return pa - pb;

    return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
  });

  return sorted.slice(0, max).map((t) => ({
    title: t.title,
    href: t.href,
    state: normState(t.state),
    priority: t.priority,
    due: t.due,
    owner: t.owner,
  }));
}
