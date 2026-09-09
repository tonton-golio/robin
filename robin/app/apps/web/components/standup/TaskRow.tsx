'use client';

import { GripVertical, CalendarClock } from 'lucide-react';
import { Pill } from '@/components/ui';
import { StatusGlyph } from './StatusGlyph';
import { TaskActions } from './TaskActions';
import { dueInfo, priorityTone, normalizeStatus, type Tone } from '@/lib/task-display';
import type { TaskItem } from '@/lib/tasks';
import type { TaskPatch } from './useTaskBoard';

export function TaskRow({
  task,
  cursor,
  editing,
  dragging,
  showParent = true,
  onStatusCycle,
  onPatch,
  onAddNote,
  onToggleEdit,
  onDragStart,
}: {
  task: TaskItem;
  cursor: boolean;
  editing: boolean;
  dragging: boolean;
  /** When false, hide parent crumb (already nested under a workstream in tree view). */
  showParent?: boolean;
  onStatusCycle: () => void;
  onPatch: (patch: TaskPatch) => void;
  onAddNote: (text: string) => Promise<boolean>;
  onToggleEdit: () => void;
  onDragStart: (e: React.PointerEvent) => void;
}) {
  const due = dueInfo(task.due);
  const done = normalizeStatus(task.state) === 'done';
  const plannedLabel = task.planned
    ? new Date(task.planned).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <li
      data-cursor={cursor || undefined}
      data-dragging={dragging || undefined}
      className={[
        'group relative rounded-[var(--radius)] transition-colors',
        'border-l-2 pl-2.5 pr-1.5 py-1.5',
        cursor
          ? 'border-l-[var(--blue)] bg-[var(--accent-wash)]'
          : 'border-l-transparent hover:bg-[var(--card-2)]',
        dragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Drag to reschedule or move between columns"
          onPointerDown={onDragStart}
          className="mt-0.5 cursor-grab touch-none text-[var(--muted)] opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing data-[cursor]:opacity-100"
          data-cursor={cursor || undefined}
        >
          <GripVertical size={13} strokeWidth={1.5} />
        </button>

        <span className="mt-0.5">
          <StatusGlyph status={task.state} onClick={(e) => { e.preventDefault(); onStatusCycle(); }} />
        </span>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggleEdit}
            className={[
              'block w-full truncate text-left text-[13.5px] font-semibold leading-snug hover:text-[var(--blue)]',
              // Completion is signalled by colour + strike, never by fading the
              // row: done rows are still meant to be read (spec section 10a).
              done && !editing ? 'text-[var(--muted)] line-through' : 'text-[var(--ink)]',
            ].join(' ')}
            title={task.title}
            aria-expanded={editing}
          >
            {task.title}
          </button>
          {/* Collapsed: one quiet meta line only */}
          {!editing ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {showParent && task.parent ? (
                <Pill tone="neutral">
                  <span title={`parent: ${task.parent}`}>
                    ↳ {task.parent.replace(/^ws-/, '').replace(/^outcome-/, '')}
                  </span>
                </Pill>
              ) : null}
              {task.priority ? <Pill tone={priorityTone(task.priority)}>{task.priority}</Pill> : null}
              {due.label ? <Pill tone={due.tone as Tone}>{due.label}</Pill> : null}
              {plannedLabel ? (
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--blue)]">
                  <CalendarClock size={11} strokeWidth={1.6} />
                  {plannedLabel}
                </span>
              ) : null}
              {task.owner && task.owner !== 'unassigned' ? (
                <span className="font-mono text-[11px] text-[var(--muted)]">{task.owner}</span>
              ) : null}
            </div>
          ) : (
            <div className="mt-2">
              <TaskActions
                task={task}
                onPatch={onPatch}
                onAddNote={onAddNote}
                onClose={onToggleEdit}
                openHref={task.href}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
