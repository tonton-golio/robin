import type { Metadata } from 'next';
import Link from 'next/link';
import React from 'react';
import { getMaintenanceSnapshot } from '@/lib/maintenance';
import { vaultFileHref } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { PageHeader, Card, Button, Pill, EmptyState } from '@/components/ui';

type Severity = 'critical' | 'warning' | 'info';

interface MaintenanceItem {
  id: string;
  title: string;
  detail?: string;
  path?: string;
  href?: string;
  meta?: string[];
  severity: Severity;
}

interface MaintenanceSection {
  id: string;
  title: string;
  summary: string;
  severity: Severity;
  count: number;
  items: MaintenanceItem[];
}

interface MaintenanceSnapshot {
  generatedAt: string;
  counts: {
    openAnnotations: number;
    stalePages: number;
    lintIssues: number;
    taskIssues: number;
    memoryIssues: number;
    outputIssues: number;
    totalIssues: number;
  };
  sections: MaintenanceSection[];
}

export const metadata: Metadata = {
  title: 'Maintenance - Robin',
};

export const dynamic = 'force-dynamic';

const COUNT_LABELS: Array<{
  key: keyof MaintenanceSnapshot['counts'];
  label: string;
}> = [
  { key: 'openAnnotations', label: 'Open annotations' },
  { key: 'stalePages', label: 'Stale pages' },
  { key: 'lintIssues', label: 'Lint issues' },
  { key: 'taskIssues', label: 'Task issues' },
  { key: 'memoryIssues', label: 'Memory issues' },
  { key: 'outputIssues', label: 'Output issues' },
];

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function fileHref(pathValue?: string): string | null {
  if (!pathValue) return null;

  const normalized = pathValue.replace(/^\/+/, '');
  if (!normalized) return null;

  return vaultFileHref(normalized);
}

function isInternalHref(href: string): boolean {
  return href.startsWith('/');
}

function severityRank(severity: Severity): number {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

type Tone = 'rust' | 'amber' | 'cyan';
function severityTone(severity: Severity): Tone {
  if (severity === 'critical') return 'rust';
  if (severity === 'warning') return 'amber';
  return 'cyan';
}
const SEVERITY_BORDER: Record<Severity, string> = {
  critical: 'border-l-[var(--warning-rust)]',
  warning: 'border-l-[var(--robin-amber)]',
  info: 'border-l-[var(--signal-cyan)]',
};

export default async function MaintenancePage(): Promise<React.ReactElement> {
  const snapshot: MaintenanceSnapshot = await getMaintenanceSnapshot();
  const sections = [...snapshot.sections].sort((a, b) => {
    const severityDelta = severityRank(a.severity) - severityRank(b.severity);
    if (severityDelta !== 0) return severityDelta;
    return b.count - a.count;
  });
  const hasIssues = snapshot.counts.totalIssues > 0;

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 pb-16 sm:px-14">
      <PageHeader
        eyebrow="Maintenance"
        title="Open issues across the vault and generated work."
        sub={`Snapshot generated ${formatTimestamp(snapshot.generatedAt)} · ${snapshot.counts.totalIssues} total issues across ${snapshot.sections.length} sections.`}
        actions={
          <div
            className={cn(
              'grid min-w-[150px] content-center gap-1 rounded-xl border bg-card px-5 py-4 text-right',
              hasIssues && 'border-[rgba(232,161,60,0.3)] bg-[rgba(232,161,60,0.08)]',
            )}
          >
            <strong className="font-mono text-[34px] font-semibold leading-none tabular-nums text-foreground">
              {snapshot.counts.totalIssues}
            </strong>
            <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Total issues</span>
          </div>
        }
      />

      <section
        className="mb-7 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Maintenance issue counts"
      >
        {COUNT_LABELS.map((count) => (
          <Card key={count.key} className="gap-2 p-3.5">
            <span className="truncate font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              {count.label}
            </span>
            <strong className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {snapshot.counts[count.key]}
            </strong>
          </Card>
        ))}
      </section>

      {sections.length === 0 || !hasIssues ? (
        <EmptyState
          title="No maintenance issues found."
          hint="Robin did not report open annotations, stale pages, lint, task, memory, or output issues."
        />
      ) : (
        <div className="grid gap-5">
          {sections.map((section) => (
            <section key={section.id}>
              <div className="mb-3 flex items-start justify-between gap-3 border-b border-border pb-2.5">
                <div className="min-w-0">
                  <h2 className="font-mono text-[13px] font-semibold uppercase tracking-wide text-foreground">
                    {section.title}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{section.summary}</p>
                </div>
                <Pill tone={severityTone(section.severity)}>{section.count}</Pill>
              </div>

              {section.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-3.5 text-xs text-muted-foreground">
                  No individual issues in this section.
                </div>
              ) : (
                <div className="grid gap-2">
                  {section.items.map((item) => {
                    const sourceHref = fileHref(item.path);
                    return (
                      <Card
                        key={item.id}
                        className={cn(
                          'flex-row items-start justify-between gap-3.5 border-l-[3px] p-3.5',
                          SEVERITY_BORDER[item.severity],
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <strong className="truncate text-sm font-semibold text-foreground">{item.title}</strong>
                          {item.detail ? (
                            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-muted-foreground">
                            {item.path ? (
                              <code className="rounded border border-border bg-background px-1.5 py-1">{item.path}</code>
                            ) : null}
                            {item.meta?.map((meta, mi) => (
                              <span key={`${mi}-${meta}`} className="rounded border border-border bg-background px-1.5 py-1">
                                {meta}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          {item.href ? (
                            <Button asChild variant="outline" size="sm">
                              {isInternalHref(item.href) ? (
                                <Link href={item.href}>Open</Link>
                              ) : (
                                <a href={item.href} rel="noreferrer" target="_blank">
                                  Open
                                </a>
                              )}
                            </Button>
                          ) : null}
                          {sourceHref ? (
                            <Button asChild variant="outline" size="sm">
                              <Link href={sourceHref}>File</Link>
                            </Button>
                          ) : null}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
