import { listOutputs } from '@/lib/catalog';
import type { MaintenanceItem, Severity } from './types';
import { ageDays, LARGE_OUTPUT_BYTES, OUTPUT_ARCHIVE_DAYS, severityRank } from './shared';

export interface OutputHygieneSection {
  title: string;
  source: string;
  total: number;
  rootFiles: number;
  logs: number;
  archiveCandidates: number;
  largeFiles: number;
  issueCount: number;
  items: OutputIssue[];
}

export interface OutputIssue {
  path: string;
  title: string;
  kind: string;
  issue: string;
  ageDays: number;
  size: number;
  href: string;
  severity: Severity;
}

export async function getOutputHygieneSection(generatedAt: string, limit: number): Promise<OutputHygieneSection> {
  const outputs = await listOutputs();
  const now = new Date(generatedAt);
  const issues: OutputIssue[] = [];
  let rootFiles = 0;
  let logs = 0;
  let largeFiles = 0;
  let archiveCandidates = 0;

  for (const item of outputs) {
    const isLog = item.path.startsWith('out/_');
    const isRootFile = item.path.split('/').length === 2 && !isLog;
    const itemAge = ageDays(item.mtime.toISOString(), now);

    if (isLog) logs += 1;
    if (isRootFile) {
      rootFiles += 1;
      issues.push(outputIssue(item, 'root-level output file', itemAge, 'info'));
    }

    if (!isLog && itemAge > OUTPUT_ARCHIVE_DAYS) {
      archiveCandidates += 1;
      issues.push(outputIssue(item, `older than ${OUTPUT_ARCHIVE_DAYS} days`, itemAge, 'warning'));
    }

    if (item.size > LARGE_OUTPUT_BYTES) {
      largeFiles += 1;
      issues.push(outputIssue(item, 'large output file', itemAge, 'warning'));
    }
  }

  return {
    title: 'Output hygiene',
    source: 'out/',
    total: outputs.length,
    rootFiles,
    logs,
    archiveCandidates,
    largeFiles,
    issueCount: issues.length,
    items: issues
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.ageDays - a.ageDays)
      .slice(0, limit),
  };
}

export function outputMaintenanceItem(item: OutputIssue): MaintenanceItem {
  return {
    id: `output:${item.path}:${item.issue}`,
    title: item.title,
    detail: item.issue,
    path: item.path,
    href: item.href,
    meta: [item.kind, `${item.ageDays}d old`, `${item.size} bytes`],
    severity: item.severity,
  };
}

function outputIssue(
  item: Awaited<ReturnType<typeof listOutputs>>[number],
  issue: string,
  itemAge: number,
  severity: Severity
): OutputIssue {
  return {
    path: item.path,
    title: item.title,
    kind: item.kind,
    issue,
    ageDays: itemAge,
    size: item.size,
    href: item.href,
    severity,
  };
}
