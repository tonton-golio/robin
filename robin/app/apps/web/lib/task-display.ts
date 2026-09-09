/**
 * Shared display logic for the Tasks board (and any other task surface).
 *
 * Pure, JSX-free helpers: lane vocabulary, ordering, date math, and tone
 * mapping. Kept separate from components so the board, rows, rail, and week
 * grid all agree on how a task is classified and coloured.
 */

import type { TaskItem } from '@/lib/tasks';

export type Tone = 'neutral' | 'amber' | 'cyan' | 'violet' | 'rust' | 'green';

/** Canonical status, collapsing the synonyms the vault carries. */
export type Status = 'open' | 'in-progress' | 'done' | 'blocked' | 'archived';

export function normalizeStatus(raw: string | undefined): Status {
  const s = (raw ?? 'open').toLowerCase();
  if (s === 'in_progress' || s === 'in-progress' || s === 'doing') return 'in-progress';
  if (s === 'done' || s === 'completed' || s === 'closed') return 'done';
  if (s === 'blocked') return 'blocked';
  if (s === 'archived') return 'archived';
  return 'open';
}

/**
 * Quick status cycle (x / Space): open → in-progress → done → open. A blocked
 * card resumes to in-progress (not a surprise reset to open); blocked is
 * otherwise reached deliberately via `[ ]`, drag, or the inline editor chip.
 */
export function cycleStatus(current: string | undefined): Status {
  const s = normalizeStatus(current);
  if (s === 'open') return 'in-progress';
  if (s === 'in-progress') return 'done';
  if (s === 'blocked') return 'in-progress';
  return 'open';
}

/**
 * The board's columns ARE the canonical status, in display order. (Workflow
 * lanes were removed 2026-06-03 — status is the single organizing axis.)
 * `archived` is filtered out upstream, so it is not a column.
 */
export const STATUS_COLUMNS = ['open', 'in-progress', 'blocked', 'done'] as const;
export type StatusColumn = (typeof STATUS_COLUMNS)[number];

export const STATUS_COLUMN_LABEL: Record<StatusColumn, string> = {
  open: 'To do',
  'in-progress': 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

/** Accent tone per status column (header baseline + glyph). */
export const STATUS_COLUMN_TONE: Record<StatusColumn, Tone> = {
  open: 'neutral',
  'in-progress': 'amber',
  blocked: 'rust',
  done: 'green',
};

/** Coerce any status string to one of the four board columns. */
export function statusColumnFromStatus(state: string | undefined): StatusColumn {
  const s = normalizeStatus(state);
  return (STATUS_COLUMNS as readonly string[]).includes(s) ? (s as StatusColumn) : 'open';
}

/** Which column a task belongs in (archived is filtered out before grouping). */
export function statusColumnFor(task: TaskItem): StatusColumn {
  return statusColumnFromStatus(task.state);
}

/** The status reached by stepping `dir` columns ([ / ]) — clamps at the ends. */
export function stepStatus(state: string | undefined, dir: 1 | -1): StatusColumn {
  const idx = STATUS_COLUMNS.indexOf(statusColumnFromStatus(state));
  return STATUS_COLUMNS[Math.max(0, Math.min(STATUS_COLUMNS.length - 1, idx + dir))]!;
}

export const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3, p4: 4 };
export const PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;

export function priorityTone(priority: string | undefined): Tone {
  if (priority === 'p0') return 'rust';
  if (priority === 'p1') return 'amber';
  if (priority === 'p2') return 'cyan';
  return 'neutral';
}

export const SIZE_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' };
export const SIZE_NAME: Record<number, string> = { 1: 'small', 2: 'medium', 3: 'large' };

/** Map a calendar classification to one of the five accent tones. */
export function classificationTone(c: string | undefined): Tone {
  switch (c) {
    case 'stakeholder':
      return 'cyan';
    case 'team':
      return 'green';
    case 'interview':
      return 'violet';
    case 'external':
      return 'amber';
    case 'focus':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** Whole-calendar-day diff for a due date, timezone-careful (mirrors TasksView). */
export function dueInfo(due: string | undefined): {
  label: string;
  tone: Tone;
  days: number | null;
} {
  if (!due) return { label: '', tone: 'neutral', days: null };
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return { label: due, tone: 'neutral', days: null };
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due.trim());
  const dueDay = dateOnly
    ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((dueDay - today) / 86400000);
  let tone: Tone = 'neutral';
  if (days < 0) tone = 'rust';
  else if (days <= 7) tone = 'amber';
  let label: string;
  if (days === 0) label = 'today';
  else if (days === 1) label = 'tomorrow';
  else if (days === -1) label = 'yesterday';
  else if (days > 1 && days < 14) label = `in ${days}d`;
  else if (days < 0 && days > -14) label = `${-days}d ago`;
  else label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { label, tone, days };
}

/** YYYY-MM-DD for a Date in local time. */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The calendar date a task is anchored to (planned instant wins over due). */
export function taskDateKey(task: TaskItem): string | null {
  if (task.planned) {
    const d = new Date(task.planned);
    if (!Number.isNaN(d.getTime())) return localDateString(d);
  }
  if (task.due) {
    const t = task.due.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  }
  return null;
}

/** Sort comparator within a column: priority, then due, then most-recently-touched. */
export function byTriage(a: TaskItem, b: TaskItem): number {
  const ap = PRIORITY_ORDER[a.priority ?? 'p9'] ?? 99;
  const bp = PRIORITY_ORDER[b.priority ?? 'p9'] ?? 99;
  if (ap !== bp) return ap - bp;
  const ad = a.due ? new Date(a.due).getTime() : Infinity;
  const bd = b.due ? new Date(b.due).getTime() : Infinity;
  if (ad !== bd) return ad - bd;
  return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
}
