'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { normalizeStatus } from '@/lib/task-display';
import type { TaskItem } from '@/lib/tasks';

/** Fields a single board interaction may patch. Mirrors /api/task/update. */
export interface TaskPatch {
  status?: string;
  priority?: string;
  size?: number;
  due?: string;
  start?: string;
  end?: string;
  owner?: string;
  planned?: string;
  category?: string;
  kind?: string;
  parent?: string;
}

interface BoardResponse {
  tasks: TaskItem[];
}

/** Apply a patch to a single task optimistically (matches the server's merge). */
function applyPatch(task: TaskItem, patch: TaskPatch): TaskItem {
  const next: TaskItem = { ...task };
  if (patch.status !== undefined) next.state = normalizeStatus(patch.status);
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.size !== undefined) next.size = patch.size;
  if (patch.owner !== undefined) next.owner = patch.owner;
  if (patch.category !== undefined) next.category = patch.category;
  if (patch.kind !== undefined) next.kind = patch.kind === '' ? undefined : patch.kind;
  if (patch.parent !== undefined) next.parent = patch.parent === '' ? undefined : patch.parent;
  if (patch.due !== undefined) next.due = patch.due === '' ? undefined : patch.due;
  if (patch.start !== undefined) next.start = patch.start === '' ? undefined : patch.start;
  if (patch.end !== undefined) next.end = patch.end === '' ? undefined : patch.end;
  if (patch.planned !== undefined) next.planned = patch.planned === '' ? undefined : patch.planned;
  return next;
}

export function useTaskBoard(initial: TaskItem[]) {
  const { data, mutate, isValidating } = useSWR<BoardResponse>('/api/tasks/board', fetcher, {
    fallbackData: { tasks: initial },
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
  const tasks = data?.tasks ?? initial;
  const [error, setError] = useState<string | null>(null);

  const patchTask = useCallback(
    async (path: string, patch: TaskPatch) => {
      setError(null);
      const optimistic = {
        tasks: (data?.tasks ?? initial).map((t) => (t.path === path ? applyPatch(t, patch) : t)),
      };
      try {
        await mutate(
          async () => {
            const res = await fetch('/api/task/update', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path, patch }),
            });
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error || `update failed (${res.status})`);
            }
            // Pull fresh truth from disk so the row reconciles exactly.
            return fetcher<BoardResponse>('/api/tasks/board');
          },
          { optimisticData: optimistic, rollbackOnError: true, revalidate: false, populateCache: true },
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'update failed');
      }
    },
    [data, initial, mutate],
  );

  const addNote = useCallback(
    async (path: string, text: string): Promise<boolean> => {
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
        void mutate(); // refresh `updated` ordering
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'note failed');
        return false;
      }
    },
    [mutate],
  );

  return { tasks, patchTask, addNote, error, clearError: () => setError(null), isValidating };
}
