'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { TaskItem } from '@/lib/tasks';
import { localDateString } from '@/lib/task-display';
import { StatusPill, DueLine, ProvLine, hasDate, isDone } from './row-bits';
import type { RowError, TaskPatch } from './useTaskBoard';

export type RowPanel = 'log' | 'due' | 'clear' | null;

export interface LeafRowHandlers {
  onSelect: (path: string) => void;
  onStep: (task: TaskItem, dir: 1 | -1) => void;
  onOpenPanel: (path: string, panel: RowPanel) => void;
  onClosePanel: () => void;
  onAppendNote: (path: string, text: string) => Promise<boolean>;
  onPatch: (path: string, patch: TaskPatch) => void;
  onMove: (task: TaskItem) => void;
  onOpen: (task: TaskItem) => void;
  onRetry: (path: string) => void;
  onReload: () => void;
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateString(d);
}

export function LeafRow({
  task,
  selected,
  saving,
  error,
  flash,
  panel,
  h,
  registerEl,
}: {
  task: TaskItem;
  selected: boolean;
  saving: boolean;
  error?: RowError;
  flash: boolean;
  panel: RowPanel;
  h: LeafRowHandlers;
  registerEl: (path: string, el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={(el) => registerEl(task.path, el)}
      className={[
        'tk-leaf',
        selected ? 'is-sel' : '',
        isDone(task) ? 'is-done' : '',
        error ? 'is-error' : '',
        flash ? 'is-flash' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      tabIndex={-1}
      aria-selected={selected}
      role="listitem"
      onClick={() => h.onSelect(task.path)}
    >
      <div className="tk-leaf-body">
        <div className="tk-title">
          <Link href={task.href} onClick={(e) => e.stopPropagation()}>
            {task.title}
          </Link>{' '}
          <span className="r-mono tk-path">{task.path}</span>
        </div>
        <ProvLine task={task} error={error} />

        {selected && !error ? (
          <div className="tk-actions">
            <button className="tk-act" onClick={(e) => (e.stopPropagation(), h.onStep(task, -1))}>
              ◂ Status<span className="k">[</span>
            </button>
            <button className="tk-act" onClick={(e) => (e.stopPropagation(), h.onStep(task, 1))}>
              Status ▸<span className="k">]</span>
            </button>
            <button className="tk-act" onClick={(e) => (e.stopPropagation(), h.onOpen(task))}>
              Edit<span className="k">e</span>
            </button>
            <button
              className="tk-act"
              onClick={(e) => (e.stopPropagation(), h.onOpenPanel(task.path, panel === 'log' ? null : 'log'))}
            >
              Log note<span className="k">c</span>
            </button>
            <button
              className="tk-act"
              onClick={(e) => (e.stopPropagation(), h.onOpenPanel(task.path, panel === 'due' ? null : 'due'))}
            >
              Due<span className="k">d</span>
            </button>
            <button className="tk-act" onClick={(e) => (e.stopPropagation(), h.onMove(task))}>
              Move<span className="k">m</span>
            </button>
            <button className="tk-act" onClick={(e) => (e.stopPropagation(), h.onOpen(task))}>
              Open<span className="k">o</span>
            </button>
            {hasDate(task) ? (
              <button
                className="tk-act danger"
                onClick={(e) => (e.stopPropagation(), h.onOpenPanel(task.path, panel === 'clear' ? null : 'clear'))}
              >
                Clear date<span className="k">D</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="tk-actions">
            <button className="tk-act" onClick={(e) => (e.stopPropagation(), h.onRetry(task.path))}>
              Retry save
            </button>
            <button className="tk-act" onClick={(e) => (e.stopPropagation(), h.onReload())}>
              Reload page state
            </button>
            <button className="tk-act" onClick={(e) => (e.stopPropagation(), h.onOpen(task))}>
              Open<span className="k">o</span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="tk-side">
        <StatusPill task={task} saving={saving} />
        <DueLine task={task} />
      </div>

      {selected && panel === 'log' ? <LogPanel task={task} h={h} /> : null}
      {selected && panel === 'due' ? <DuePanel task={task} h={h} /> : null}
      {selected && panel === 'clear' ? <ClearPanel task={task} h={h} /> : null}
    </div>
  );
}

function LogPanel({ task, h }: { task: TaskItem; h: LeafRowHandlers }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const ok = await h.onAppendNote(task.path, t);
    setBusy(false);
    if (ok) setText('');
  }
  return (
    <div className="tk-logbox open" onClick={(e) => e.stopPropagation()}>
      <div className="tk-lh">
        <span>Log — {task.slug} · appends to robin:log (never overwrites)</span>
      </div>
      <div className="tk-entries">
        {task.summary ? (
          <div className="tk-e">
            <span className="em">latest · {task.owner ?? 'unassigned'}</span> — {task.summary}
          </div>
        ) : (
          <div className="tk-e r-mono">no notes captured here yet — appends land on the task page</div>
        )}
      </div>
      <div className="tk-addrow">
        <input
          ref={ref}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') h.onClosePanel();
          }}
          placeholder="append a log note"
          aria-label="New log note"
        />
        <button className="r-btn r-btn--primary tk-btn-sm" disabled={busy} onClick={submit}>
          Append
        </button>
      </div>
    </div>
  );
}

function DuePanel({ task, h }: { task: TaskItem; h: LeafRowHandlers }) {
  return (
    <div className="tk-duepop open" onClick={(e) => e.stopPropagation()}>
      <div className="tk-dl r-mono">
        {task.due ? `due ${task.due.slice(0, 10)}` : 'no due date'} ·{' '}
        {task.start || task.end ? `planned ${task.start ?? '—'} → ${task.end ?? '—'}` : 'no planned window'} · step
        with buttons
      </div>
      <div className="tk-steps">
        <button className="tk-act" onClick={() => h.onPatch(task.path, { due: daysFromNow(0) })}>
          Today
        </button>
        <button className="tk-act" onClick={() => h.onPatch(task.path, { due: daysFromNow(1) })}>
          Tomorrow
        </button>
        <button className="tk-act" onClick={() => h.onPatch(task.path, { due: daysFromNow(7) })}>
          +1 week
        </button>
        <span className="r-mono tk-sep">·</span>
        <button className="tk-act" onClick={() => h.onPatch(task.path, { start: daysFromNow(0) })}>
          planned start today
        </button>
        <button className="tk-act" onClick={() => h.onPatch(task.path, { end: daysFromNow(1) })}>
          planned end tmrw
        </button>
      </div>
    </div>
  );
}

function ClearPanel({ task, h }: { task: TaskItem; h: LeafRowHandlers }) {
  return (
    <div className="tk-clrconf open" onClick={(e) => e.stopPropagation()}>
      <div className="tk-ct">Clear the due date?</div>
      <div>
        Removes <span className="r-mono">robin:due {task.due?.slice(0, 10) ?? ''}</span> — this task will no longer
        count as overdue and drops off the timeline. Destructive: writes an edit that erases the deadline.
      </div>
      <div className="tk-btnrow">
        <button
          className="r-btn r-btn--danger tk-btn-sm"
          onClick={() => {
            h.onPatch(task.path, { due: '', start: '', end: '', planned: '' });
            h.onClosePanel();
          }}
        >
          Clear date
        </button>
        <button className="r-btn tk-btn-sm" onClick={() => h.onClosePanel()}>
          Cancel
        </button>
      </div>
    </div>
  );
}
