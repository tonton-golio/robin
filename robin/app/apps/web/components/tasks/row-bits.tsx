'use client';

import type { TaskItem } from '@/lib/tasks';
import { normalizeStatus, statusColumnFromStatus, STATUS_COLUMN_LABEL, dueInfo } from '@/lib/task-display';
import { provenanceFor, type Provenance } from './task-view';
import type { RowError } from './useTaskBoard';

/** The single square status pill. Blue is reserved for the rollup — never here. */
export function StatusPill({ task, saving }: { task: TaskItem; saving: boolean }) {
  if (saving) return <span className="tk-pill saving">Saving…</span>;
  const col = statusColumnFromStatus(task.state);
  const cls = { open: 'todo', 'in-progress': 'inprog', blocked: 'blocked', done: 'done' }[col];
  return <span className={`tk-pill ${cls}`}>{STATUS_COLUMN_LABEL[col]}</span>;
}

/** Mono due line — red ONLY when overdue; muted otherwise. */
export function DueLine({ task }: { task: TaskItem }) {
  const { days } = dueInfo(task.due);
  if (task.due && /^\d{4}-\d{2}-\d{2}/.test(task.due) && days !== null) {
    const date = new Date(`${task.due.slice(0, 10)}T00:00:00`);
    const label = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toLowerCase();
    if (days < 0) {
      return (
        <span className="tk-due od">
          due {label} · {-days}d overdue
        </span>
      );
    }
    return <span className="tk-due">due {label}</span>;
  }
  if (task.end && /^\d{4}-\d{2}-\d{2}/.test(task.end)) {
    const date = new Date(`${task.end.slice(0, 10)}T00:00:00`);
    return (
      <span className="tk-due">
        planned end {date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toLowerCase()}
      </span>
    );
  }
  return <span className="tk-due">no due date</span>;
}

/** One mono provenance line: relative updated + actor + last note (best available). */
export function ProvLine({ task, error }: { task: TaskItem; error?: RowError }) {
  if (error) {
    return (
      <div className="tk-prov err" role="alert">
        save failed · {error.call}
        {error.priorStatusLabel ? ` · status rolled back to ${error.priorStatusLabel}` : ''} ·{' '}
        <span className="note">{error.message} — retry or reload</span>
      </div>
    );
  }
  const p: Provenance = provenanceFor(task);
  return (
    <div className="tk-prov">
      updated {p.when} ·{' '}
      <span className="r-actor" data-who={p.who}>
        {p.actor}
      </span>
      {p.note ? (
        <>
          {' · '}
          <span className="note">&ldquo;{p.note}&rdquo;</span>
        </>
      ) : null}
    </div>
  );
}

export function hasDate(task: TaskItem): boolean {
  return Boolean(
    (task.due && task.due.trim()) ||
      (task.start && task.start.trim()) ||
      (task.end && task.end.trim()) ||
      (task.planned && task.planned.trim()),
  );
}

export function isDone(task: TaskItem): boolean {
  return normalizeStatus(task.state) === 'done';
}
