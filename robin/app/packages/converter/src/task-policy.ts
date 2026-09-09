/** Shared task mutation vocabulary for browser and agent writers. */
export const TASK_STATUSES = ['open', 'in-progress', 'blocked', 'done', 'dropped', 'superseded', 'cancelled'] as const;
export const TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;
export const TASK_KINDS = ['task', 'workstream', 'outcome'] as const;
export const TASK_PATCH_FIELDS = ['status', 'priority', 'size', 'due', 'start', 'end', 'owner', 'planned', 'category', 'kind', 'parent', 'project', 'next_action', 'acceptance'] as const;
export type TaskPatchField = typeof TASK_PATCH_FIELDS[number];
export type TaskPatch = Partial<Record<TaskPatchField, string | number | null>>;
const dates = new Set(['due', 'start', 'end', 'planned']);

/** Unknown keys are ignored; recognized invalid values fail before any write. */
export function normalizeTaskPatch(input: Record<string, unknown>): TaskPatch {
  const result: TaskPatch = {};
  for (const key of TASK_PATCH_FIELDS) {
    let value = input[key];
    if (value === undefined) continue;
    if (value === '' || value === null) {
      if (key === 'status' || key === 'priority') throw new Error(`${key} cannot be empty`);
      result[key] = null;
      continue;
    }
    if (key === 'size') {
      if (typeof value !== 'number' || ![1, 2, 3].includes(value)) throw new Error('size must be 1, 2, or 3');
    } else {
      if (typeof value !== 'string') throw new Error(`${key} must be a string`);
      if (['status', 'priority', 'kind'].includes(key)) value = value.toLowerCase();
      if (key === 'status' && !TASK_STATUSES.includes(value as typeof TASK_STATUSES[number])) throw new Error('invalid task status');
      if (key === 'priority' && !TASK_PRIORITIES.includes(value as typeof TASK_PRIORITIES[number])) throw new Error('invalid task priority');
      if (key === 'kind' && !TASK_KINDS.includes(value as typeof TASK_KINDS[number])) throw new Error('invalid task kind');
      if (dates.has(key)) {
        const text = value as string;
        const day = text.slice(0, 10);
        const calendarDate = new Date(`${day}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text) || !Number.isFinite(Date.parse(text)) || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day) throw new Error(`${key} must be an ISO date`);
      }
    }
    result[key] = value as string | number;
  }
  return result;
}

/** Preserve unrelated metadata; null removes only the specified field. */
export function applyTaskPatch(frontmatter: Record<string, unknown>, patch: TaskPatch): Record<string, unknown> {
  const result = { ...frontmatter };
  // A legacy state-only task keeps its lifecycle during unrelated field edits.
  if (result.status === undefined && typeof result.state === 'string') result.status = result.state;
  delete result.state;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = value;
  }
  return result;
}
