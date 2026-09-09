'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TaskItem } from '@/lib/tasks';
import {
  STATUS_COLUMNS,
  STATUS_COLUMN_LABEL,
  statusColumnFromStatus,
  type StatusColumn,
} from '@/lib/task-display';
import { StatusPill, DueLine, ProvLine } from './row-bits';
import type { RowError } from './useTaskBoard';

const PER_COLUMN_CAP = 80;

export function BoardView({
  leaves,
  selectedPath,
  saving,
  rowErrors,
  flash,
  onSelect,
  onSetStatus,
  onOpen,
  registerEl,
}: {
  leaves: TaskItem[];
  selectedPath: string | null;
  saving: Set<string>;
  rowErrors: Record<string, RowError>;
  flash: Set<string>;
  onSelect: (path: string) => void;
  onSetStatus: (task: TaskItem, col: StatusColumn) => void;
  onOpen: (task: TaskItem) => void;
  registerEl: (path: string, el: HTMLDivElement | null) => void;
}) {
  const byCol: Record<StatusColumn, TaskItem[]> = { open: [], 'in-progress': [], blocked: [], done: [] };
  for (const t of leaves) byCol[statusColumnFromStatus(t.state)].push(t);

  return (
    <div className="tk-board">
      {STATUS_COLUMNS.map((col) => (
        <BoardColumn
          key={col}
          col={col}
          tasks={byCol[col]}
          selectedPath={selectedPath}
          saving={saving}
          rowErrors={rowErrors}
          flash={flash}
          onSelect={onSelect}
          onSetStatus={onSetStatus}
          onOpen={onOpen}
          registerEl={registerEl}
        />
      ))}
    </div>
  );
}

function BoardColumn({
  col,
  tasks,
  selectedPath,
  saving,
  rowErrors,
  flash,
  onSelect,
  onSetStatus,
  onOpen,
  registerEl,
}: {
  col: StatusColumn;
  tasks: TaskItem[];
  selectedPath: string | null;
  saving: Set<string>;
  rowErrors: Record<string, RowError>;
  flash: Set<string>;
  onSelect: (path: string) => void;
  onSetStatus: (task: TaskItem, col: StatusColumn) => void;
  onOpen: (task: TaskItem) => void;
  registerEl: (path: string, el: HTMLDivElement | null) => void;
}) {
  const [dropArmed, setDropArmed] = useState(false);
  const shown = tasks.slice(0, PER_COLUMN_CAP);
  const overflow = tasks.length - shown.length;

  return (
    <div className={`tk-bcol${dropArmed ? ' drop' : ''}`}>
      <div className={`tk-bcolhead${col === 'blocked' ? ' blocked' : ''}`}>
        <span className="r-bar">{STATUS_COLUMN_LABEL[col]}</span>
        <span className="tk-col-count r-mono">
          {tasks.length}
          {col === 'done' ? ' this week' : ''}
        </span>
      </div>
      <div
        className="tk-cards"
        onDragOver={(e) => {
          e.preventDefault();
          setDropArmed(true);
        }}
        onDragLeave={() => setDropArmed(false)}
        onDrop={(e) => {
          setDropArmed(false);
          const path = e.dataTransfer.getData('text/task-path');
          const task = tasks.find((t) => t.path === path) ?? { path } as TaskItem;
          if (path) onSetStatus(task, col);
        }}
      >
        {shown.map((t) => (
          <div
            key={t.path}
            ref={(el) => registerEl(t.path, el)}
            className={[
              'tk-tcard',
              selectedPath === t.path ? 'is-sel' : '',
              rowErrors[t.path] ? 'is-error' : '',
              flash.has(t.path) ? 'is-flash' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            tabIndex={-1}
            aria-selected={selectedPath === t.path}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/task-path', t.path)}
            onClick={() => onSelect(t.path)}
          >
            <div className="tk-ct">
              <Link href={t.href} onClick={(e) => e.stopPropagation()}>
                {t.title}
              </Link>
            </div>
            <div className="tk-crow2">
              <StatusPill task={t} saving={saving.has(t.path)} />
              <DueLine task={t} />
            </div>
            <ProvLine task={t} error={rowErrors[t.path]} />
          </div>
        ))}
        {overflow > 0 ? (
          <div className="tk-col-overflow r-mono">+{overflow} more · filter to narrow</div>
        ) : null}
      </div>
    </div>
  );
}
