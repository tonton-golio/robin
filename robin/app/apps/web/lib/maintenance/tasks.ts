import path from 'path';
import { pageHref } from '@/lib/catalog';
import { readPage, type PageData } from '@/lib/read-page';
import { locateVault } from '@/lib/vault';
import { isArchivePath } from '@/lib/archive';
import type { MaintenanceItem, Severity } from './types';
import { DONE_TASK_STATES, severityRank, stringValue, titleFromPath, walk } from './shared';

// Task INTEGRITY only. Deadline signals (overdue / missing-or-past due date)
// were removed 2026-07 — /standup owns deadlines fully. What remains here are
// genuine vault-integrity signals on open task pages: missing owner, missing
// priority, open tasks parked in an archive/ directory, and parse errors.
// These are folded into the Format & link integrity dashboard section.
export interface TaskIntegritySection {
  title: string;
  source: string;
  total: number;
  open: number;
  done: number;
  missingOwner: number;
  missingPriority: number;
  openInArchive: number;
  parseErrors: number;
  issueCount: number;
  items: TaskIssue[];
}

export interface TaskIssue {
  path: string;
  title: string;
  state: string;
  issue: string;
  owner?: string;
  priority?: string;
  href: string;
  severity: Severity;
}

export async function getTaskIntegritySection(limit: number): Promise<TaskIntegritySection> {
  const vault = locateVault();
  const relFiles = (await walk(vault, path.join('brain', 'tasks'))).filter((file) => file.endsWith('.html'));
  const issues: TaskIssue[] = [];

  let total = 0;
  let open = 0;
  let done = 0;
  let missingOwner = 0;
  let missingPriority = 0;
  let openInArchive = 0;
  let parseErrors = 0;

  for (const relFile of relFiles) {
    const page = await readPage(relFile);
    if ('error' in page) {
      parseErrors += 1;
      total += 1;
      issues.push({
        path: relFile,
        title: titleFromPath(relFile),
        state: 'unknown',
        issue: page.error,
        href: pageHref(relFile),
        severity: 'critical',
      });
      continue;
    }

    // brain/tasks/ also holds non-task pages (the _index.html hub, occasional
    // notes). Only pages that declare robin:type=task carry the owner/priority
    // integrity contract — scanning the rest produced false "missing owner /
    // missing priority" issues. Skip anything not typed as a task.
    if (page.meta.type !== 'task') continue;
    total += 1;

    const state = taskState(page);
    const isDone = DONE_TASK_STATES.has(state.toLowerCase());
    const owner = stringValue(page.meta.owner) ?? stringValue(page.frontmatter['owner']);
    const priority = stringValue(page.meta.priority) ?? stringValue(page.frontmatter['priority']);

    if (isDone) {
      done += 1;
      continue;
    }

    open += 1;
    if (isArchivePath(relFile)) {
      openInArchive += 1;
      issues.push(taskIssue(page, state, 'open task is in archive', 'warning'));
    }
    if (!owner) {
      missingOwner += 1;
      issues.push(taskIssue(page, state, 'missing owner', 'warning'));
    }
    if (!priority) {
      missingPriority += 1;
      issues.push(taskIssue(page, state, 'missing priority', 'info'));
    }
  }

  return {
    title: 'Task integrity',
    source: 'brain/tasks/**/*.html',
    total,
    open,
    done,
    missingOwner,
    missingPriority,
    openInArchive,
    parseErrors,
    issueCount: issues.length,
    items: issues
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.path.localeCompare(b.path))
      .slice(0, limit),
  };
}

export function taskMaintenanceItem(item: TaskIssue): MaintenanceItem {
  return {
    id: `task:${item.path}:${item.issue}`,
    title: item.title,
    detail: item.issue,
    path: item.path,
    href: item.href,
    meta: [item.state, item.owner, item.priority].filter((value): value is string => Boolean(value)),
    severity: item.severity,
  };
}

function taskIssue(page: PageData, state: string, issue: string, severity: Severity): TaskIssue {
  return {
    path: page.filePath,
    title: page.title || titleFromPath(page.filePath),
    state,
    issue,
    owner: stringValue(page.meta.owner) ?? stringValue(page.frontmatter['owner']),
    priority: stringValue(page.meta.priority) ?? stringValue(page.frontmatter['priority']),
    href: pageHref(page.filePath),
    severity,
  };
}

function taskState(page: PageData): string {
  return stringValue(page.meta.state)
    ?? stringValue(page.frontmatter['status'])
    ?? stringValue(page.frontmatter['state'])
    ?? 'open';
}
