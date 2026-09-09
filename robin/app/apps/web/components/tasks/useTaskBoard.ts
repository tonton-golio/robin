'use client';

import { useCallback, useRef, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { normalizeStatus, statusColumnFromStatus, STATUS_COLUMN_LABEL } from '@/lib/task-display';
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

/** A row-anchored save failure: the optimistic change rolled back to `prior`. */
export interface RowError {
  message: string;
  call: string;
  priorStatusLabel: string;
}

/** Apply a patch to a single task optimistically (matches the server merge). */
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

/** Compute the reverse patch that would restore `task` to its pre-patch state. */
function inversePatch(task: TaskItem, patch: TaskPatch): TaskPatch {
  const inv: TaskPatch = {};
  if (patch.status !== undefined) inv.status = normalizeStatus(task.state);
  if (patch.priority !== undefined) inv.priority = task.priority ?? '';
  if (patch.size !== undefined) inv.size = task.size ?? 0;
  if (patch.owner !== undefined) inv.owner = task.owner ?? 'unassigned';
  if (patch.due !== undefined) inv.due = task.due ?? '';
  if (patch.start !== undefined) inv.start = task.start ?? '';
  if (patch.end !== undefined) inv.end = task.end ?? '';
  if (patch.planned !== undefined) inv.planned = task.planned ?? '';
  if (patch.parent !== undefined) inv.parent = task.parent ?? '';
  return inv;
}

export interface UndoEntry {
  path: string;
  patch: TaskPatch; // the reverse patch to re-apply
}

export function useTaskBoard(initial: TaskItem[]) {
  const { data, error: loadError, isLoading, mutate, isValidating } = useSWR<BoardResponse>(
    '/api/tasks/board',
    fetcher,
    { fallbackData: { tasks: initial }, keepPreviousData: true, revalidateOnFocus: false },
  );
  const tasks = data?.tasks ?? initial;

  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, RowError>>({});
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const undoStack = useRef<UndoEntry[]>([]);

  const markSaving = useCallback((path: string, on: boolean) => {
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const flashRow = useCallback((path: string) => {
    setFlash((prev) => new Set(prev).add(path));
    window.setTimeout(() => {
      setFlash((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }, 2400);
  }, []);

  const clearRowError = useCallback((path: string) => {
    setRowErrors((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  const patchTask = useCallback(
    async (path: string, patch: TaskPatch, opts?: { recordUndo?: boolean }) => {
      clearRowError(path);
      const current = (data?.tasks ?? initial).find((t) => t.path === path);
      const priorStatus = current ? normalizeStatus(current.state) : 'open';
      if (opts?.recordUndo !== false && current) {
        undoStack.current.push({ path, patch: inversePatch(current, patch) });
      }
      const optimistic = {
        tasks: (data?.tasks ?? initial).map((t) => (t.path === path ? applyPatch(t, patch) : t)),
      };
      markSaving(path, true);
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
              const err = new Error(j.error || `update failed (${res.status})`);
              (err as Error & { status?: number }).status = res.status;
              throw err;
            }
            return fetcher<BoardResponse>('/api/tasks/board');
          },
          { optimisticData: optimistic, rollbackOnError: true, revalidate: false, populateCache: true },
        );
        flashRow(path);
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        setRowErrors((prev) => ({
          ...prev,
          [path]: {
            message: e instanceof Error ? e.message : 'update failed',
            call: `POST /api/task/update → ${status ?? 'ERR'}`,
            priorStatusLabel: STATUS_COLUMN_LABEL[statusColumnFromStatus(priorStatus)],
          },
        }));
      } finally {
        markSaving(path, false);
      }
    },
    [clearRowError, data, flashRow, initial, markSaving, mutate],
  );

  const addNote = useCallback(
    async (path: string, text: string): Promise<boolean> => {
      clearRowError(path);
      markSaving(path, true);
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
        await mutate();
        flashRow(path);
        return true;
      } catch (e) {
        setRowErrors((prev) => ({
          ...prev,
          [path]: {
            message: e instanceof Error ? e.message : 'note failed',
            call: 'POST /api/task/note',
            priorStatusLabel: '',
          },
        }));
        return false;
      } finally {
        markSaving(path, false);
      }
    },
    [clearRowError, flashRow, markSaving, mutate],
  );

  const undoLast = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return false;
    void patchTask(entry.path, entry.patch, { recordUndo: false });
    return true;
  }, [patchTask]);

  const retry = useCallback(
    (path: string) => {
      // Reload fresh truth for the row and clear the anchored error.
      clearRowError(path);
      void mutate();
    },
    [clearRowError, mutate],
  );

  return {
    tasks,
    patchTask,
    addNote,
    undoLast,
    retry,
    reload: () => void mutate(),
    saving,
    rowErrors,
    clearRowError,
    flash,
    loadError: loadError as Error | undefined,
    isLoading,
    isValidating,
    canUndo: undoStack.current.length > 0,
  };
}
