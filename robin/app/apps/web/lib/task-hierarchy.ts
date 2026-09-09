/**
 * Task hierarchy helpers: outcome → workstream → task.
 * Pure, UI-free — used by TasksView and StandupBoard.
 */

import type { TaskItem } from '@/lib/tasks';
import { normalizeStatus, PRIORITY_ORDER, dueInfo } from '@/lib/task-display';

export type TaskKind = 'outcome' | 'workstream' | 'task';

export function taskKind(t: TaskItem): TaskKind {
  const k = (t.kind ?? '').toLowerCase();
  if (k === 'outcome' || k === 'workstream' || k === 'task') return k;
  return 'task';
}

export function isLeaf(t: TaskItem): boolean {
  return taskKind(t) === 'task';
}

export function isActiveStatus(state: string | undefined): boolean {
  const s = normalizeStatus(state);
  return s === 'open' || s === 'in-progress' || s === 'blocked';
}

export interface WorkstreamNode {
  workstream: TaskItem | null; // null = orphan leaves under this outcome
  leaves: TaskItem[];
  /** Active (non-done) leaf count. */
  active: number;
  /** Done leaf count. */
  done: number;
  /** Total leaves. */
  total: number;
}

export interface OutcomeNode {
  outcome: TaskItem | null; // null = ungrouped root
  workstreams: WorkstreamNode[];
  active: number;
  done: number;
  total: number;
}

function byTitle(a: TaskItem, b: TaskItem): number {
  return a.title.localeCompare(b.title);
}

function byLeafTriage(a: TaskItem, b: TaskItem): number {
  const ap = PRIORITY_ORDER[a.priority ?? 'p9'] ?? 99;
  const bp = PRIORITY_ORDER[b.priority ?? 'p9'] ?? 99;
  if (ap !== bp) return ap - bp;
  const ad = dueInfo(a.due).days;
  const bd = dueInfo(b.due).days;
  // Overdue first (negative), then soon, then undated last.
  if (ad === null && bd === null) return byTitle(a, b);
  if (ad === null) return 1;
  if (bd === null) return -1;
  if (ad !== bd) return ad - bd;
  return byTitle(a, b);
}

/**
 * Build outcome → workstream → leaf tree from a flat task list.
 * Orphans (no parent / missing parent) land under a null outcome node.
 */
export function buildTaskTree(tasks: TaskItem[]): OutcomeNode[] {
  const bySlug = new Map<string, TaskItem>();
  for (const t of tasks) bySlug.set(t.slug, t);

  const outcomes = tasks.filter((t) => taskKind(t) === 'outcome').sort(byTitle);
  const workstreams = tasks.filter((t) => taskKind(t) === 'workstream');
  const leaves = tasks.filter((t) => taskKind(t) === 'task');

  const outcomeSlugs = new Set(outcomes.map((o) => o.slug));
  const wsByParent = new Map<string | null, TaskItem[]>();
  for (const ws of workstreams) {
    const p = ws.parent && outcomeSlugs.has(ws.parent) ? ws.parent : null;
    const list = wsByParent.get(p) ?? [];
    list.push(ws);
    wsByParent.set(p, list);
  }
  for (const list of wsByParent.values()) list.sort(byTitle);

  const wsSlugs = new Set(workstreams.map((w) => w.slug));
  const leavesByParent = new Map<string | null, TaskItem[]>();
  for (const leaf of leaves) {
    let key: string | null = null;
    if (leaf.parent && wsSlugs.has(leaf.parent)) key = leaf.parent;
    else if (leaf.parent && outcomeSlugs.has(leaf.parent)) {
      // Leaf hung directly on outcome — virtual workstream key uses outcome slug with prefix.
      key = `__direct__${leaf.parent}`;
    } else if (leaf.parent && bySlug.has(leaf.parent)) {
      // Parent exists but is itself a leaf (mis-stamp) — still group under that slug.
      key = leaf.parent;
    } else {
      key = null;
    }
    const list = leavesByParent.get(key) ?? [];
    list.push(leaf);
    leavesByParent.set(key, list);
  }
  for (const list of leavesByParent.values()) list.sort(byLeafTriage);

  function makeWs(ws: TaskItem | null, leafKey: string | null): WorkstreamNode {
    const ls = leavesByParent.get(leafKey) ?? [];
    // consume so we don't double-list orphans later
    if (leafKey !== null) leavesByParent.delete(leafKey);
    const done = ls.filter((l) => normalizeStatus(l.state) === 'done').length;
    const active = ls.filter((l) => isActiveStatus(l.state)).length;
    return { workstream: ws, leaves: ls, active, done, total: ls.length };
  }

  const nodes: OutcomeNode[] = [];

  for (const outcome of outcomes) {
    const wss = wsByParent.get(outcome.slug) ?? [];
    wsByParent.delete(outcome.slug);
    const wsNodes: WorkstreamNode[] = wss.map((ws) => makeWs(ws, ws.slug));
    // Direct children of outcome (no workstream)
    const direct = makeWs(null, `__direct__${outcome.slug}`);
    if (direct.total > 0) wsNodes.push(direct);

    let active = 0;
    let done = 0;
    let total = 0;
    for (const w of wsNodes) {
      active += w.active;
      done += w.done;
      total += w.total;
    }
    nodes.push({ outcome, workstreams: wsNodes, active, done, total });
  }

  // Workstreams whose parent is missing / not an outcome
  const orphanWs = wsByParent.get(null) ?? [];
  wsByParent.delete(null);
  const orphanWsNodes = orphanWs.map((ws) => makeWs(ws, ws.slug));

  // Remaining unparented leaves
  const unparented = leavesByParent.get(null) ?? [];
  leavesByParent.delete(null);
  // Any leftover keys (mis-parented) also unparented
  for (const [key, ls] of leavesByParent) {
    if (key) unparented.push(...ls);
  }
  unparented.sort(byLeafTriage);

  if (orphanWsNodes.length || unparented.length) {
    const wsNodes = [...orphanWsNodes];
    if (unparented.length) {
      const done = unparented.filter((l) => normalizeStatus(l.state) === 'done').length;
      const active = unparented.filter((l) => isActiveStatus(l.state)).length;
      wsNodes.push({
        workstream: null,
        leaves: unparented,
        active,
        done,
        total: unparented.length,
      });
    }
    let active = 0;
    let done = 0;
    let total = 0;
    for (const w of wsNodes) {
      active += w.active;
      done += w.done;
      total += w.total;
    }
    nodes.push({ outcome: null, workstreams: wsNodes, active, done, total });
  }

  return nodes;
}

/** Progress fraction 0..1 from done/total leaves (containers with 0 leaves → 0). */
export function progressFraction(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, done / total));
}

export function progressLabel(done: number, total: number, active: number): string {
  if (total === 0) return 'no leaves';
  return `${done}/${total} done · ${active} active`;
}
