import { describe, expect, it } from 'vitest';
import { buildTaskTree, progressFraction, taskKind } from './task-hierarchy';
import type { TaskItem } from './tasks';

function t(partial: Partial<TaskItem> & { slug: string; title: string }): TaskItem {
  return {
    path: `brain/tasks/${partial.slug}.html`,
    href: `/p/${partial.slug}`,
    state: 'open',
    tags: [],
    mtime: new Date().toISOString(),
    ...partial,
  };
}

describe('task hierarchy', () => {
  it('defaults missing kind to task', () => {
    expect(taskKind(t({ slug: 'a', title: 'A' }))).toBe('task');
  });

  it('nests leaves under workstream under outcome', () => {
    const tree = buildTaskTree([
      t({ slug: 'outcome-gate', title: 'Gate', kind: 'outcome', priority: 'p0' }),
      t({
        slug: 'ws-speed',
        title: 'Speed',
        kind: 'workstream',
        parent: 'outcome-gate',
        priority: 'p1',
      }),
      t({
        slug: 'leaf-a',
        title: 'Leaf A',
        kind: 'task',
        parent: 'ws-speed',
        priority: 'p1',
        state: 'in-progress',
      }),
      t({
        slug: 'leaf-b',
        title: 'Leaf B',
        kind: 'task',
        parent: 'ws-speed',
        priority: 'p2',
        state: 'done',
      }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.outcome?.slug).toBe('outcome-gate');
    expect(tree[0]!.workstreams).toHaveLength(1);
    expect(tree[0]!.workstreams[0]!.leaves.map((l) => l.slug)).toEqual(['leaf-a', 'leaf-b']);
    expect(tree[0]!.done).toBe(1);
    expect(tree[0]!.active).toBe(1);
    expect(tree[0]!.total).toBe(2);
  });

  it('collects unparented leaves under null outcome', () => {
    const tree = buildTaskTree([t({ slug: 'orphan', title: 'Orphan', kind: 'task' })]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.outcome).toBeNull();
    expect(tree[0]!.workstreams[0]!.leaves[0]!.slug).toBe('orphan');
  });

  it('progressFraction clamps', () => {
    expect(progressFraction(0, 0)).toBe(0);
    expect(progressFraction(2, 4)).toBe(0.5);
    expect(progressFraction(5, 4)).toBe(1);
  });
});
