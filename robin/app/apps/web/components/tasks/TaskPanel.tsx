'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
import { ErrorBanner } from '@/components/ui';
import { StatusGlyph } from '@/components/standup/StatusGlyph';
import { TaskActions, type TaskActionsState } from '@/components/standup/TaskActions';
import { normalizeStatus, type Status } from '@/lib/task-display';
import type { TaskPatch } from '@/components/standup/useTaskBoard';

/**
 * Interactive controls on a task's own detail page — the same status /
 * priority / size / due / owner + comment surface as the Standup board, so a
 * task can be driven from wherever you're reading it. Local optimistic state
 * keeps the controls responsive; router.refresh() re-renders the server page so
 * the body (and any appended note) stays in sync.
 */
export function TaskPanel({
  path,
  initial,
}: {
  path: string;
  initial: TaskActionsState;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<TaskActionsState>(initial);
  const [error, setError] = useState<string | null>(null);

  function applyLocal(prev: TaskActionsState, patch: TaskPatch): TaskActionsState {
    const next = { ...prev };
    if (patch.status !== undefined) next.state = patch.status;
    if (patch.priority !== undefined) next.priority = patch.priority;
    if (patch.size !== undefined) next.size = patch.size;
    if (patch.owner !== undefined) next.owner = patch.owner;
    if (patch.due !== undefined) next.due = patch.due === '' ? undefined : patch.due;
    if (patch.start !== undefined) next.start = patch.start === '' ? undefined : patch.start;
    if (patch.end !== undefined) next.end = patch.end === '' ? undefined : patch.end;
    return next;
  }

  async function onPatch(patch: TaskPatch) {
    const prev = fields;
    setFields(applyLocal(prev, patch));
    setError(null);
    try {
      const res = await fetch('/api/task/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, patch }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `update failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setFields(prev); // rollback
      setError(e instanceof Error ? e.message : 'update failed');
    }
  }

  async function onAddNote(text: string): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch('/api/task/note', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, text }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `note failed (${res.status})`);
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'note failed');
      return false;
    }
  }

  const status: Status = normalizeStatus(fields.state);

  return (
    <section className="no-print mb-8 rounded-[var(--radius-lg)] bg-[var(--card)] p-3 shadow-[var(--offset)]">
      <div className="mb-2 flex items-center gap-2 border-b border-[var(--hairline)] pb-2">
        <SlidersHorizontal size={13} strokeWidth={1.6} className="text-[var(--muted)]" />
        <h2 className="m-0 font-mono text-[length:var(--lab-size)] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          Manage task
        </h2>
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--muted)]">
          <StatusGlyph status={status} size={13} />
          {status}
        </span>
      </div>
      {error ? (
        <div className="mb-2">
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      ) : null}
      <TaskActions task={fields} onPatch={onPatch} onAddNote={onAddNote} />
    </section>
  );
}
