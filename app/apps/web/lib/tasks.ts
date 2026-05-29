import fs from 'fs/promises';
import path from 'path';
import { readPage } from '@/lib/read-page';
import { locateVault } from '@/lib/vault';
import { pageHref } from '@/lib/catalog';

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
    if (entry.name === 'archive') continue;
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
        created: page.meta.created,
        updated: page.meta.updated,
        tags: page.meta.tags ?? [],
        mtime: page.mtime.toISOString(),
      };
    }),
  );
  return tasks.filter((t): t is TaskItem => t !== null);
}
