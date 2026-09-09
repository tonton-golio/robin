import fs from 'fs/promises';
import path from 'path';
import { readPage } from '@/lib/read-page';
import { locateVault } from '@/lib/vault';
import { pageHref } from '@/lib/catalog';
import { isArchiveDirectoryName } from '@/lib/archive';

export interface TaskItem {
  title: string;
  path: string;
  href: string;
  slug: string;
  summary?: string;
  state: string;
  priority?: string;
  size?: number;
  owner?: string;
  due?: string;
  /** Planned start date (date-only) — origin of the task's timeline bar. */
  start?: string;
  /** Planned end date (date-only) — terminus of the task's timeline bar (falls back to `due`). */
  end?: string;
  /** Free-form classification (project | infra | team | board | …). */
  category?: string;
  /**
   * Hierarchy role: outcome | workstream | task.
   * Missing on older leaves — treat as `task`.
   */
  kind?: string;
  /** Immediate parent task slug (workstream or outcome). */
  parent?: string;
  /** Planned datetime (absolute instant) for time-blocking on the rail. */
  planned?: string;
  created?: string;
  updated?: string;
  tags: string[];
  mtime: string;
}

async function walk(root: string, relDir: string): Promise<string[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(path.join(root, relDir), { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (isArchiveDirectoryName(entry.name)) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const inner = await walk(root, rel);
      found.push(...inner);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      found.push(rel);
    }
  }
  return found;
}

export async function listTasks(): Promise<TaskItem[]> {
  const vault = locateVault();
  const files = await walk(vault, 'brain/tasks');
  const tasks = await Promise.all(
    files.map(async (file): Promise<TaskItem | null> => {
      const page = await readPage(file);
      if ('error' in page) return null;
      // Only real task pages — exclude index/hub pages that live under /tasks/.
      if (page.meta.type && page.meta.type !== 'task') return null;
      if (!page.meta.type && !file.includes('/tasks/')) return null;
      const stateRaw = (page.meta.state ?? 'open').toLowerCase();
      return {
        title: page.title,
        path: page.filePath,
        href: pageHref(page.filePath),
        slug: page.meta.slug,
        summary: page.meta.summary,
        state: stateRaw,
        priority: page.meta.priority,
        size: page.meta.size,
        owner: page.meta.owner ?? 'unassigned',
        due: page.meta.due,
        start: page.meta.start,
        end: page.meta.end,
        category: page.meta.category,
        kind: page.meta.kind,
        parent: page.meta.parent,
        planned: page.meta.planned,
        created: page.meta.created,
        updated: page.meta.updated,
        tags: page.meta.tags ?? [],
        mtime: page.mtime.toISOString(),
      };
    }),
  );
  return tasks.filter((t): t is TaskItem => t !== null);
}
