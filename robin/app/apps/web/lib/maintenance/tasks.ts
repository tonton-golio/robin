import path from 'path';
import { pageHref } from '@/lib/catalog';
import { readPage, type PageData } from '@/lib/read-page';
import { locateVault } from '@/lib/vault';
import type { MaintenanceItem, Severity } from './types';
import {
  ageDays,
  DONE_TASK_STATES,
  isBeforeDay,
  severityRank,
  STALE_OPEN_TASK_DAYS,
  stringValue,
  titleFromPath,
  walk,
} from './shared';

export interface TaskHygieneSection {
  title: string;
  source: string;
  total: number;
  open: number;
  done: number;
  overdue: number;
  missingDue: number;
  missingOwner: number;
  missingPriority: number;
  staleOpen: number;
  openInArchive: number;
  issueCount: number;
  items: TaskIssue[];
}

export interface TaskIssue {
  path: string;
  title: string;
  state: string;
  issue: string;
  due?: string;
  owner?: string;
  priority?: string;
  updated?: string;
  href: string;
  severity: Severity;
}

export async function getTaskHygieneSection(generatedAt: string, limit: number): Promise<TaskHygieneSection> {
  const vault = locateVault();
  const relFiles = (await walk(vault, path.join('brain', 'tasks')))
    .filter((file) => file.endsWith('.html'));
  const now = new Date(generatedAt);
  const issues: TaskIssue[] = [];

  let open = 0;
  let done = 0;
  let overdue = 0;
  let missingDue = 0;
  let missingOwner = 0;
  let missingPriority = 0;
  let staleOpen = 0;
  let openInArchive = 0;

  for (const relFile of relFiles) {
    const page = await readPage(relFile);
    if ('error' in page) {
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

    const state = taskState(page);
    const isDone = DONE_TASK_STATES.has(state.toLowerCase());
    const due = stringValue(page.meta.due) ?? stringValue(page.frontmatter['due']);
    const owner = stringValue(page.meta.owner) ?? stringValue(page.frontmatter['owner']);
    const priority = stringValue(page.meta.priority) ?? stringValue(page.frontmatter['priority']);
    const updated = stringValue(page.meta.updated) ?? stringValue(page.frontmatter['updated']);

    if (isDone) {
      done += 1;
      continue;
    }

    open += 1;
    if (relFile.includes('/archive/')) {
      openInArchive += 1;
      issues.push(taskIssue(page, state, 'open task is in archive', 'warning'));
    }

    if (!due) {
      missingDue += 1;
      issues.push(taskIssue(page, state, 'missing due date', 'info'));
    } else if (isBeforeDay(due, now)) {
      overdue += 1;
      issues.push(taskIssue(page, state, 'overdue', 'critical'));
    }

    if (!owner) {
      missingOwner += 1;
      issues.push(taskIssue(page, state, 'missing owner', 'warning'));
    }

    if (!priority) {
      missingPriority += 1;
      issues.push(taskIssue(page, state, 'missing priority', 'info'));
    }

    if (updated && ageDays(updated, now) > STALE_OPEN_TASK_DAYS) {
      staleOpen += 1;
      issues.push(taskIssue(page, state, `not updated in ${STALE_OPEN_TASK_DAYS}+ days`, 'warning'));
    }
  }

  return {
    title: 'Task hygiene',
    source: 'brain/tasks/**/*.html',
    total: relFiles.length,
    open,
    done,
    overdue,
    missingDue,
    missingOwner,
    missingPriority,
    staleOpen,
    openInArchive,
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
    meta: [item.state, item.due, item.owner, item.priority, item.updated].filter((value): value is string => Boolean(value)),
    severity: item.severity,
  };
}

function taskIssue(page: PageData, state: string, issue: string, severity: Severity): TaskIssue {
  return {
    path: page.filePath,
    title: page.title || titleFromPath(page.filePath),
    state,
    issue,
    due: stringValue(page.meta.due) ?? stringValue(page.frontmatter['due']),
    owner: stringValue(page.meta.owner) ?? stringValue(page.frontmatter['owner']),
    priority: stringValue(page.meta.priority) ?? stringValue(page.frontmatter['priority']),
    updated: stringValue(page.meta.updated) ?? stringValue(page.frontmatter['updated']),
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
