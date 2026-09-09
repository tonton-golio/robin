import { OWNER_KEY, isOwner } from '@/lib/owner-identity';
/**
 * Pure, JSX-free helpers for the unified Tasks page.
 *
 * URL view-state (parse / serialize), provenance derivation, relative-time,
 * and rollup-count math. Kept out of the components so the client orchestrator,
 * the tree, the board, and the calendar band all agree — and so the page never
 * re-derives grouping / status / overdue math that already lives in
 * `lib/task-hierarchy.ts` + `lib/task-display.ts`.
 */

import type { TaskItem } from '@/lib/tasks';
import { normalizeStatus, dueInfo } from '@/lib/task-display';
import { isLeaf, isActiveStatus, taskKind, buildTaskTree } from '@/lib/task-hierarchy';

export type ViewMode = 'tree' | 'board';
export type CalMode = 'day' | 'week' | 'timeline';
export type RollupFilter = 'all' | 'overdue' | 'blocked' | 'mine' | 'done';

/** The full, URL-addressable view state. Every knob round-trips through `?…`. */
export interface ViewState {
  view: ViewMode;
  cal: CalMode;
  calOpen: boolean;
  outcome: string; // slug | 'all'
  q: string;
  rf: RollupFilter;
  owner: string; // owner-lane filter | '' (none)
}

export const DEFAULT_VIEW: ViewState = {
  view: 'tree',
  cal: 'day',
  calOpen: false,
  outcome: 'all',
  q: '',
  rf: 'all',
  owner: '',
};

const VIEW_MODES: ViewMode[] = ['tree', 'board'];
const CAL_MODES: CalMode[] = ['day', 'week', 'timeline'];
const ROLLUP_FILTERS: RollupFilter[] = ['all', 'overdue', 'blocked', 'mine', 'done'];

function pick<T extends string>(raw: unknown, allowed: T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as string[]).includes(raw) ? (raw as T) : fallback;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse a `searchParams`-shaped record (server) into a complete ViewState. */
export function parseViewParams(sp: Record<string, string | string[] | undefined>): ViewState {
  return {
    view: pick(first(sp.view), VIEW_MODES, DEFAULT_VIEW.view),
    cal: pick(first(sp.cal), CAL_MODES, DEFAULT_VIEW.cal),
    calOpen: first(sp.calOpen) === '1' || sp.cal !== undefined,
    outcome: first(sp.outcome) || DEFAULT_VIEW.outcome,
    q: first(sp.q) || '',
    rf: pick(first(sp.rf), ROLLUP_FILTERS, DEFAULT_VIEW.rf),
    owner: first(sp.owner) || '',
  };
}

/** Serialize a ViewState to a query string (omitting defaults for clean URLs). */
export function serializeParams(v: ViewState): string {
  const p = new URLSearchParams();
  if (v.view !== DEFAULT_VIEW.view) p.set('view', v.view);
  if (v.calOpen) {
    p.set('calOpen', '1');
    if (v.cal !== DEFAULT_VIEW.cal) p.set('cal', v.cal);
  }
  if (v.outcome !== 'all') p.set('outcome', v.outcome);
  if (v.q) p.set('q', v.q);
  if (v.rf !== 'all') p.set('rf', v.rf);
  if (v.owner) p.set('owner', v.owner);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The current user, for the "mine" rollup filter + owner-lane default. */
export const CURRENT_OWNER = OWNER_KEY || 'owner';

function ownerMatches(task: TaskItem, who: string): boolean {
  const o = (task.owner ?? '').toLowerCase();
  return who === CURRENT_OWNER ? isOwner(o) : o.includes(who.toLowerCase());
}

export interface RollupCounts {
  open: number;
  overdue: number;
  blocked: number;
  mine: number;
  done: number; // done this week
}

/** Rollup counts over the leaf set (mirrors the header's five toggles). */
export function computeRollup(tasks: TaskItem[]): RollupCounts {
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  let open = 0;
  let overdue = 0;
  let blocked = 0;
  let mine = 0;
  let done = 0;
  for (const t of tasks) {
    if (!isLeaf(t)) continue;
    const status = normalizeStatus(t.state);
    if (status === 'archived') continue;
    const active = isActiveStatus(t.state);
    if (active) open += 1;
    if (status === 'blocked') blocked += 1;
    if (active && dueInfo(t.due).days !== null && (dueInfo(t.due).days as number) < 0) overdue += 1;
    if (active && ownerMatches(t, CURRENT_OWNER)) mine += 1;
    if (status === 'done') {
      const u = t.updated ? new Date(t.updated).getTime() : new Date(t.mtime).getTime();
      if (!Number.isNaN(u) && u >= weekAgo) done += 1;
    }
  }
  return { open, overdue, blocked, mine, done };
}

/** Does this leaf survive the rollup filter + owner-lane + search + outcome? */
export function leafMatches(
  t: TaskItem,
  v: ViewState,
  outcomeOfLeaf: (t: TaskItem) => string | null,
  showDone: boolean,
): boolean {
  const status = normalizeStatus(t.state);
  if (status === 'archived') return false;
  if (!showDone && status === 'done' && v.rf !== 'done') return false;

  // rollup filter
  if (v.rf === 'overdue') {
    const d = dueInfo(t.due).days;
    if (!(isActiveStatus(t.state) && d !== null && d < 0)) return false;
  } else if (v.rf === 'blocked') {
    if (status !== 'blocked') return false;
  } else if (v.rf === 'mine') {
    if (!(isActiveStatus(t.state) && ownerMatches(t, CURRENT_OWNER))) return false;
  } else if (v.rf === 'done') {
    if (status !== 'done') return false;
  }

  // owner-lane filter (composes on top)
  if (v.owner && !ownerMatches(t, v.owner)) return false;

  // outcome filter
  if (v.outcome !== 'all') {
    if (outcomeOfLeaf(t) !== v.outcome) return false;
  }

  // free-text search
  if (v.q.trim()) {
    const needle = v.q.trim().toLowerCase();
    const hay = [t.title, t.owner ?? '', t.summary ?? '', ...(t.tags ?? [])].join(' ').toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

/** Map leaf slug → owning outcome slug (or null) via the built tree. */
export function outcomeIndex(tasks: TaskItem[]): Map<string, string | null> {
  const idx = new Map<string, string | null>();
  const tree = buildTaskTree(tasks);
  for (const on of tree) {
    const oslug = on.outcome?.slug ?? null;
    for (const ws of on.workstreams) {
      for (const leaf of ws.leaves) idx.set(leaf.slug, oslug);
    }
  }
  return idx;
}

/** Human relative time, e.g. "3h ago" / "just now" / "2d ago". */
export function relativeTime(iso: string | undefined): string {
  if (!iso) return 'unknown';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'unknown';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export interface Provenance {
  when: string; // relative
  actor: string; // display label
  who: 'human' | 'robin' | undefined; // for .r-actor[data-who]
  note: string | undefined; // last log-ish note (best available)
}

/**
 * Derive a provenance line from the fields TaskItem actually carries.
 *
 * NOTE: `/api/tasks/board` does not (yet) return the last `robin:log` note or a
 * write actor. Until it does, we render honestly from `updated` + `owner`, using
 * `summary` as the note when present. A richer board payload (last-log-note +
 * actor) would let this match /activity's provenance exactly — see report.
 */
export function provenanceFor(t: TaskItem): Provenance {
  const owner = (t.owner ?? 'unassigned').toLowerCase();
  let who: 'human' | 'robin' | undefined;
  if (owner.includes('robin')) who = 'robin';
  else if (isOwner(owner)) who = 'human';
  const actor = t.owner && t.owner !== 'unassigned' ? t.owner : 'unassigned';
  return {
    when: relativeTime(t.updated ?? t.mtime),
    actor,
    who,
    note: t.summary,
  };
}

/** A stepped-highlight thesis line for the rollup, generated from the data. */
export function rollupThesis(tasks: TaskItem[], counts: RollupCounts): string {
  // Find the nearest-due outcome as the "critical path" anchor.
  let anchor: { title: string; days: number } | null = null;
  for (const t of tasks) {
    if (taskKind(t) !== 'outcome' || !t.due) continue;
    const d = dueInfo(t.due).days;
    if (d === null) continue;
    if (!anchor || d < anchor.days) anchor = { title: t.title, days: d };
  }
  const lateClause =
    counts.overdue === 0
      ? 'nothing is late.'
      : `${counts.overdue} thing${counts.overdue === 1 ? ' is' : 's are'} already late.`;
  if (anchor) {
    const gate = anchor.title.toLowerCase();
    const when = anchor.days < 0 ? `${-anchor.days} days past` : `${anchor.days} days out`;
    return `${gate} is ${when}. ${lateClause}`;
  }
  return `${counts.open} open · ${counts.done} done this week. ${lateClause}`;
}
