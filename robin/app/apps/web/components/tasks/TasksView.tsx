'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Circle, CircleDot, CheckCircle2, AlertOctagon, Pause, Search, Flag, User, UserX } from 'lucide-react';
import type { TaskItem } from '@/lib/tasks';

interface Props {
  tasks: TaskItem[];
}

const STATE_ORDER: Record<string, number> = {
  in_progress: 0,
  'in-progress': 0,
  open: 1,
  blocked: 2,
  done: 3,
  completed: 3,
  closed: 3,
  archived: 4,
};

const STATE_LABEL: Record<string, string> = {
  in_progress: 'in progress',
  'in-progress': 'in progress',
  open: 'open',
  blocked: 'blocked',
  done: 'done',
  completed: 'done',
  closed: 'done',
  archived: 'archived',
};

function stateIcon(state: string) {
  switch (state) {
    case 'in_progress':
    case 'in-progress':
      return <CircleDot size={14} strokeWidth={1.5} style={{ color: 'var(--robin-amber)' }} />;
    case 'done':
    case 'completed':
    case 'closed':
      return <CheckCircle2 size={14} strokeWidth={1.5} style={{ color: '#6ba368' }} />;
    case 'blocked':
      return <AlertOctagon size={14} strokeWidth={1.5} style={{ color: 'var(--warning-rust)' }} />;
    case 'archived':
      return <Pause size={14} strokeWidth={1.5} style={{ color: 'var(--text-2)' }} />;
    default:
      return <Circle size={14} strokeWidth={1.5} style={{ color: 'var(--text-2)' }} />;
  }
}

const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3, p4: 4 };

const SIZE_LABEL: Record<number, string> = { 1: 'S', 2: 'M', 3: 'L' };
const SIZE_NAME: Record<number, string> = { 1: 'small', 2: 'medium', 3: 'large' };

function formatDue(due: string | undefined): { label: string; tone: 'overdue' | 'soon' | 'later' | null } {
  if (!due) return { label: '', tone: null };
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return { label: due, tone: null };
  // Diff whole calendar days, not raw ms: a task "due today" must read as 0 days
  // regardless of the viewer's timezone. A bare date string ("2026-05-30") parses
  // as UTC midnight, so anchor the due day to the calendar date the author meant —
  // its UTC components for date-only input, otherwise its local components — and
  // compare against the viewer's local today, both floored to a midnight boundary.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due.trim());
  const dueDay = dateOnly
    ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 86400000;
  const days = Math.round((dueDay - today) / day);
  let tone: 'overdue' | 'soon' | 'later' = 'later';
  if (days < 0) tone = 'overdue';
  else if (days <= 7) tone = 'soon';
  let label: string;
  if (days === 0) label = 'today';
  else if (days === 1) label = 'tomorrow';
  else if (days === -1) label = 'yesterday';
  else if (days > 1 && days < 14) label = `in ${days}d`;
  else if (days < 0 && days > -14) label = `${-days}d ago`;
  else label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { label, tone };
}

export function TasksView({ tasks }: Props) {
  const [state, setState] = useState<string>('all');
  const [priority, setPriority] = useState<string>('all');
  const [size, setSize] = useState<string>('all');
  const [owner, setOwner] = useState<string>('all');
  const [search, setSearch] = useState('');

  const states = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) counts.set(t.state, (counts.get(t.state) ?? 0) + 1);
    return Array.from(counts.entries()).sort(
      ([a], [b]) => (STATE_ORDER[a] ?? 99) - (STATE_ORDER[b] ?? 99),
    );
  }, [tasks]);

  const priorities = useMemo(() => {
    const seen = new Set<string>();
    for (const t of tasks) if (t.priority) seen.add(t.priority);
    return Array.from(seen).sort((a, b) => (PRIORITY_ORDER[a] ?? 99) - (PRIORITY_ORDER[b] ?? 99));
  }, [tasks]);

  const sizes = useMemo(() => {
    const seen = new Set<number>();
    for (const t of tasks) if (t.size) seen.add(t.size);
    return Array.from(seen).sort((a, b) => a - b);
  }, [tasks]);

  const owners = useMemo(() => {
    const seen = new Set<string>();
    for (const t of tasks) if (t.owner) seen.add(t.owner);
    return Array.from(seen).sort((a, b) => {
      // keep "unassigned" pinned to the end of the facet
      if (a === 'unassigned') return 1;
      if (b === 'unassigned') return -1;
      return a.localeCompare(b);
    });
  }, [tasks]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = tasks.filter((t) => {
      if (state !== 'all' && t.state !== state) return false;
      if (priority !== 'all' && t.priority !== priority) return false;
      if (size !== 'all' && String(t.size ?? '') !== size) return false;
      if (owner !== 'all' && t.owner !== owner) return false;
      if (term) {
        const hay = `${t.title} ${t.summary ?? ''} ${t.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    return list.sort((a, b) => {
      const ap = PRIORITY_ORDER[a.priority ?? 'p9'] ?? 99;
      const bp = PRIORITY_ORDER[b.priority ?? 'p9'] ?? 99;
      if (ap !== bp) return ap - bp;
      const ad = a.due ? new Date(a.due).getTime() : Infinity;
      const bd = b.due ? new Date(b.due).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
    });
  }, [tasks, state, priority, size, owner, search]);

  return (
    <div className="tasks-page">
      <header className="tasks-head">
        <div>
          <p className="tasks-eyebrow">tasks</p>
          <h1 className="tasks-title">What&apos;s on the board</h1>
          <p className="tasks-sub">
            {filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}
            {state !== 'all' ? ` · ${STATE_LABEL[state] ?? state}` : ''}
            {priority !== 'all' ? ` · ${priority}` : ''}
            {size !== 'all' ? ` · size ${SIZE_NAME[Number(size)] ?? size}` : ''}
            {owner !== 'all' ? ` · ${owner}` : ''}
          </p>
        </div>
        <div className="tasks-search">
          <Search size={14} strokeWidth={1.5} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search tasks…"
          />
        </div>
      </header>

      <div className="tasks-filter-row">
        <div className="tasks-chips">
          <FilterChip active={state === 'all'} onClick={() => setState('all')}>
            all <span>{tasks.length}</span>
          </FilterChip>
          {states.map(([s, n]) => (
            <FilterChip key={s} active={state === s} onClick={() => setState(s)}>
              {stateIcon(s)} {STATE_LABEL[s] ?? s} <span>{n}</span>
            </FilterChip>
          ))}
        </div>

        {priorities.length > 0 && (
          <div className="tasks-chips">
            <FilterChip active={priority === 'all'} onClick={() => setPriority('all')}>
              any priority
            </FilterChip>
            {priorities.map((p) => (
              <FilterChip key={p} active={priority === p} onClick={() => setPriority(p)}>
                <Flag size={11} strokeWidth={1.5} /> {p}
              </FilterChip>
            ))}
          </div>
        )}

        {sizes.length > 0 && (
          <div className="tasks-chips">
            <FilterChip active={size === 'all'} onClick={() => setSize('all')}>
              any size
            </FilterChip>
            {sizes.map((s) => (
              <FilterChip key={s} active={size === String(s)} onClick={() => setSize(String(s))}>
                <span title={SIZE_NAME[s] ?? ''}>{SIZE_LABEL[s]}</span>
              </FilterChip>
            ))}
          </div>
        )}

        {owners.length > 1 && (
          <div className="tasks-chips">
            <FilterChip active={owner === 'all'} onClick={() => setOwner('all')}>
              anyone
            </FilterChip>
            {owners.map((o) => (
              <FilterChip key={o} active={owner === o} onClick={() => setOwner(o)}>
                {o === 'unassigned' ? <UserX size={11} strokeWidth={1.5} /> : <User size={11} strokeWidth={1.5} />} {o}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      <ul className="tasks-list">
        {filtered.length === 0 ? (
          <li className="tasks-empty">No tasks match this filter.</li>
        ) : (
          filtered.map((t) => {
            const due = formatDue(t.due);
            return (
              <li key={t.path}>
                <Link href={t.href} className="task-row">
                  <span className="task-row-state" title={STATE_LABEL[t.state] ?? t.state}>
                    {stateIcon(t.state)}
                  </span>
                  <div className="task-row-main">
                    <div className="task-row-title">{t.title}</div>
                    {t.summary && <div className="task-row-summary">{t.summary}</div>}
                  </div>
                  <div className="task-row-meta">
                    {t.priority && (
                      <span className="task-row-pill" data-pill={t.priority}>
                        {t.priority}
                      </span>
                    )}
                    {t.size && (
                      <span
                        className="task-row-pill"
                        data-size={t.size}
                        title={`size ${t.size} · ${SIZE_NAME[t.size] ?? ''}`}
                      >
                        {SIZE_LABEL[t.size] ?? t.size}
                      </span>
                    )}
                    {due.label && (
                      <span className="task-row-pill" data-due={due.tone ?? undefined}>
                        {due.label}
                      </span>
                    )}
                    {t.owner && (
                      <span
                        className="task-row-owner"
                        data-unassigned={t.owner === 'unassigned' ? '' : undefined}
                      >
                        {t.owner}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="tasks-chip" data-active={active} onClick={onClick}>
      {children}
    </button>
  );
}
