'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X, Send, ExternalLink, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { SIZE_LABEL, PRIORITIES, normalizeStatus, localDateString, dueInfo } from '@/lib/task-display';
import type { TaskPatch } from './useTaskBoard';

/** Minimal shape the action surface needs — satisfied by TaskItem or RobinMeta. */
export interface TaskActionsState {
  state?: string;
  priority?: string;
  size?: number;
  due?: string;
  start?: string;
  end?: string;
  owner?: string;
  summary?: string;
  parent?: string;
  kind?: string;
  category?: string;
}

/** Date string (YYYY-MM-DD) `n` days from today, local. */
function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateString(d);
}

const STATUS_OPTS: Array<{ value: string; label: string }> = [
  { value: 'open', label: 'open' },
  { value: 'in-progress', label: 'doing' },
  { value: 'blocked', label: 'blocked' },
  { value: 'done', label: 'done' },
];

/** Quiet Slate field chrome: 1px --line-strong boundary + --radius-sm. */
const FIELD =
  'rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--card)] px-1.5 py-1 text-[11px] text-[var(--ink)] outline-none focus:border-[var(--blue)]';
/** Same, but the tighter vertical rhythm used inside the "more" drawer. */
const FIELD_TIGHT =
  'rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--card)] px-1.5 py-0.5 text-[11px] text-[var(--ink)] outline-none focus:border-[var(--blue)]';
/** Shared eyebrow/micro-label recipe (--lab-size / --lab-track / --lab-weight). */
const LABEL = 'font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]';

/**
 * Compact task detail + edit surface.
 * Default: details + essentials (status, priority, due, owner, note).
 * "More" reveals size + schedule span.
 */
export function TaskActions({
  task,
  onPatch,
  onAddNote,
  onClose,
  openHref,
}: {
  task: TaskActionsState;
  onPatch: (patch: TaskPatch) => void;
  onAddNote: (text: string) => Promise<boolean>;
  onClose?: () => void;
  openHref?: string;
}) {
  const status = normalizeStatus(task.state);
  const [owner, setOwner] = useState(task.owner && task.owner !== 'unassigned' ? task.owner : '');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [more, setMore] = useState(false);

  const due = dueInfo(task.due);
  const parentLabel = task.parent
    ? task.parent.replace(/^ws-/, '').replace(/^outcome-/, '').replace(/-/g, ' ')
    : null;

  async function submitNote() {
    const text = note.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await onAddNote(text);
    setSending(false);
    if (ok) {
      setNote('');
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    }
  }

  return (
    <div
      className="space-y-2.5 rounded-[var(--radius-lg)] bg-[var(--card-2)] px-3 py-2.5 shadow-[var(--offset-sm)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Details */}
      {(task.summary || parentLabel || task.kind || task.category) && (
        <div className="space-y-1 border-b border-[var(--hairline)] pb-2">
          {task.summary ? (
            <p className="m-0 text-[12.5px] leading-snug text-[var(--ink)]">{task.summary}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-[var(--muted)]">
            {task.kind && task.kind !== 'task' ? (
              <span className="uppercase tracking-[0.06em] text-[var(--blue)]">{task.kind}</span>
            ) : null}
            {parentLabel ? <span title={task.parent}>under {parentLabel}</span> : null}
            {task.category ? <span className="uppercase tracking-[0.06em]">{task.category}</span> : null}
            {due.label ? (
              <span className={due.tone === 'rust' ? 'text-[var(--red)]' : undefined}>
                due {due.label}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* Essentials — one compact row */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => onPatch({ status: e.target.value })}
          className={`${FIELD} font-mono`}
        >
          {STATUS_OPTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Priority"
          value={task.priority ?? ''}
          onChange={(e) => onPatch({ priority: e.target.value || undefined })}
          className={`${FIELD} font-mono`}
        >
          <option value="">prio</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <input
          type="date"
          aria-label="Due date"
          value={(task.due ?? '').slice(0, 10)}
          onChange={(e) => onPatch({ due: e.target.value || '' })}
          className={FIELD}
        />
        <div className="flex items-center gap-0.5">
          <Mini onClick={() => onPatch({ due: dayOffset(0) })}>today</Mini>
          <Mini onClick={() => onPatch({ due: dayOffset(1) })}>tmrw</Mini>
          {task.due ? (
            <Mini tone="rust" onClick={() => onPatch({ due: '' })}>
              ×
            </Mini>
          ) : null}
        </div>

        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          onBlur={() => {
            const v = owner.trim();
            if (v !== (task.owner && task.owner !== 'unassigned' ? task.owner : '')) {
              onPatch({ owner: v || 'unassigned' });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          placeholder="owner"
          className={`${FIELD} w-28 placeholder:text-[var(--muted)]`}
        />
      </div>

      {/* Note */}
      <div className="flex items-center gap-1.5">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitNote();
          }}
          placeholder="Add a note…"
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--card)] px-2 py-1 text-[12px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--blue)]"
        />
        <button
          type="button"
          onClick={() => void submitNote()}
          disabled={sending || !note.trim()}
          aria-label="Add note"
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)] transition-colors hover:border-[var(--blue)] hover:text-[var(--ink)] disabled:opacity-40"
        >
          {saved ? <Check size={12} strokeWidth={2} /> : <Send size={12} strokeWidth={1.6} />}
          {saved ? 'saved' : 'note'}
        </button>
      </div>

      {/* More: size + span */}
      <div>
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          className={`inline-flex items-center gap-1 ${LABEL} hover:text-[var(--ink)]`}
        >
          {more ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          more
        </button>
        {more ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1">
              <span className={LABEL}>size</span>
              {([1, 2, 3] as const).map((s) => (
                <Chip key={s} active={task.size === s} onClick={() => onPatch({ size: s })}>
                  {SIZE_LABEL[s]}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className={LABEL}>span</span>
              <input
                type="date"
                aria-label="start date"
                value={(task.start ?? '').slice(0, 10)}
                onChange={(e) => onPatch({ start: e.target.value })}
                className={FIELD_TIGHT}
              />
              <span className="font-mono text-[11px] text-[var(--muted)]">→</span>
              <input
                type="date"
                aria-label="end date"
                value={(task.end ?? '').slice(0, 10)}
                onChange={(e) => onPatch({ end: e.target.value })}
                className={FIELD_TIGHT}
              />
              {task.start || task.end ? (
                <Chip tone="rust" onClick={() => onPatch({ start: '', end: '' })}>
                  clear
                </Chip>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer */}
      {openHref || onClose ? (
        <div className="flex items-center justify-between border-t border-[var(--hairline)] pt-2">
          {openHref ? (
            <Link
              href={openHref}
              className={`inline-flex items-center gap-1 ${LABEL} hover:text-[var(--blue)]`}
            >
              <ExternalLink size={11} strokeWidth={1.6} /> open page
            </Link>
          ) : (
            <span />
          )}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close editor"
              className={`inline-flex items-center gap-1 ${LABEL} hover:text-[var(--ink)]`}
            >
              <X size={12} strokeWidth={1.6} /> close
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Mini({
  onClick,
  tone,
  children,
}: {
  onClick: () => void;
  tone?: 'rust';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-[var(--radius-sm)] px-1 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors',
        tone === 'rust'
          ? 'text-[var(--red)] hover:bg-[var(--red-wash)]'
          : 'text-[var(--muted)] hover:bg-[var(--accent-wash)] hover:text-[var(--ink)]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  tone,
  onClick,
  children,
}: {
  active?: boolean;
  tone?: 'rust';
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className={[
        'rounded-full border px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors',
        active
          ? 'border-[var(--blue)]/40 bg-[var(--accent-wash)] text-[var(--blue-deep)]'
          : tone === 'rust'
            ? 'border-[var(--red)]/30 text-[var(--red)] hover:bg-[var(--red-wash)]'
            : 'border-[var(--line)] text-[var(--muted)] hover:bg-[var(--accent-wash)] hover:text-[var(--ink)]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
