import Link from 'next/link';
import React from 'react';
import {
  annotationEventTimestamp,
  isClosedAnnotationStatus,
  type AnnotationRecord,
} from '@/lib/annotations';
import { annotationLogDir, listAnnotations } from '@/lib/annotation-store';
import { vaultFileHref, vaultPageHref } from '@/lib/routes';
import { AnnotationActions } from '@/components/annotations/AnnotationActions';
import { PageHeader, Button, Card, EmptyState, Pill } from '@/components/ui';

// This page reads annotation JSONL straight off the filesystem in an async
// Server Component. Force dynamic rendering so it never serves a stale,
// build-time snapshot of the comments stream.
export const dynamic = 'force-dynamic';

type Tone = 'neutral' | 'amber' | 'cyan' | 'violet' | 'rust' | 'green';

interface AnnotationGroup {
  pagePath: string;
  title: string;
  href: string | null;
  items: AnnotationRecord[];
}

function pageHref(pagePath?: string): string | null {
  return pagePath?.endsWith('.html') ? vaultPageHref(pagePath) : null;
}

function pageTitle(pagePath: string): string {
  const leaf = pagePath.split('/').pop() ?? pagePath;
  return leaf.replace(/\.html$/i, '').replace(/[-_]+/g, ' ');
}

function statusTone(status: string): Tone {
  if (status === 'needs-attention') return 'amber';
  if (status === 'resolved') return 'green';
  if (status === 'rejected' || status === 'deleted') return 'rust';
  if (status === 'archived') return 'violet';
  return 'cyan';
}

function eventTime(annotation: AnnotationRecord): string {
  return annotationEventTimestamp(annotation);
}

function formatTime(value?: string): string | null {
  if (!value) return null;
  return value.slice(0, 16).replace('T', ' ');
}

function annotationLocation(annotation: AnnotationRecord): string {
  if (annotation.pin) return `Slide ${annotation.pin.slide + 1}`;
  if (annotation.anchor?.text_quote?.exact) return 'Text selection';
  return 'Page note';
}

function groupAnnotations(items: AnnotationRecord[]): AnnotationGroup[] {
  const groups = new Map<string, AnnotationRecord[]>();
  for (const item of items) {
    const pagePath = item.page_path ?? item.render_path ?? 'unknown';
    groups.set(pagePath, [...(groups.get(pagePath) ?? []), item]);
  }

  return Array.from(groups.entries())
    .map(([pagePath, groupItems]) => ({
      pagePath,
      title: pageTitle(pagePath),
      href: pageHref(pagePath),
      items: groupItems.sort((a, b) => eventTime(b).localeCompare(eventTime(a))),
    }))
    .sort((a, b) => eventTime(b.items[0]!).localeCompare(eventTime(a.items[0]!)));
}

function AnnotationRow({ annotation, compact = false }: { annotation: AnnotationRecord; compact?: boolean }) {
  const quote = annotation.anchor?.text_quote?.exact;
  const href = pageHref(annotation.page_path ?? annotation.render_path);
  const title = annotation.comment_md || quote || annotation.page_path || annotation.id;
  return (
    <div className="grid gap-3 border-t border-border/70 py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={statusTone(annotation.status)}>{annotation.status}</Pill>
        {annotation.kind ? <Pill>{annotation.kind}</Pill> : null}
        {annotation.pageChanged ? (
          <span title="The page changed since this comment was made — its anchor may be stale.">
            <Pill tone="amber">page changed</Pill>
          </span>
        ) : null}
        <span className="font-mono text-[11px] text-muted-foreground">{annotationLocation(annotation)}</span>
        {formatTime(eventTime(annotation)) ? (
          <span className="font-mono text-[11px] text-muted-foreground">{formatTime(eventTime(annotation))}</span>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <p className="m-0 text-[14px] font-semibold leading-snug text-foreground">{title}</p>
        {!compact && annotation.comment_md && quote ? (
          <p className="m-0 border-l-2 border-primary py-1.5 pl-3 text-[13px] leading-relaxed text-muted-foreground">
            {quote}
          </p>
        ) : null}
        {annotation.resolution_md || annotation.resolution ? (
          <p className="m-0 text-[12px] leading-relaxed text-muted-foreground">
            {annotation.resolution_md ?? annotation.resolution}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11px] text-muted-foreground">
          {href ? (
            <Link href={href} className="text-[var(--signal-cyan)] no-underline hover:underline">
              Open page →
            </Link>
          ) : null}
          {annotation.page_path ? <span>{annotation.page_path}</span> : null}
        </div>
        <AnnotationActions
          id={annotation.id}
          status={annotation.status}
          pagePath={annotation.page_path}
          renderPath={annotation.render_path}
        />
      </div>
    </div>
  );
}

export default async function CommentsPage(): Promise<React.ReactElement> {
  const annotations = await listAnnotations({ includeClosed: true });
  const open = annotations.filter((item) => !isClosedAnnotationStatus(item.status));
  const needsAttention = open.filter((item) => item.status === 'needs-attention');
  const plainOpen = open.filter((item) => item.status !== 'needs-attention');
  const recentlyClosed = annotations
    .filter((item) => isClosedAnnotationStatus(item.status))
    .slice(0, 12);
  const groups = groupAnnotations(plainOpen);
  const eventStreamPath = annotations[0]?.logPath ?? `${annotationLogDir()}/${new Date().toISOString().slice(0, 7)}.jsonl`;

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 pb-16 sm:px-14">
      <PageHeader
        eyebrow="Comments"
        title="Notes waiting to become memory, tasks, or edits."
        sub={`${open.length} open · ${needsAttention.length} need attention · ${recentlyClosed.length} recently closed.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={vaultFileHref(eventStreamPath)}>Event stream</Link>
          </Button>
        }
      />

      {open.length === 0 ? (
        <EmptyState
          title="No comments captured yet."
          hint="Open any brain or output page, select text or leave a page-level note, then save it for ingest."
        />
      ) : (
        <section className="grid gap-6">
          {needsAttention.length > 0 ? (
            <section>
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-[15px] font-semibold text-foreground">Needs attention</h2>
                <span className="font-mono text-[11px] text-muted-foreground">{needsAttention.length}</span>
              </div>
              <Card className="gap-0 p-4">
                {needsAttention.map((annotation) => (
                  <AnnotationRow key={annotation.id} annotation={annotation} />
                ))}
              </Card>
            </section>
          ) : null}

          {groups.length > 0 ? (
            <section className="grid gap-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-[15px] font-semibold text-foreground">Open by page</h2>
                <span className="font-mono text-[11px] text-muted-foreground">{plainOpen.length}</span>
              </div>
              {groups.map((group) => (
                <section key={group.pagePath} className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="m-0 text-[15px] font-semibold leading-snug text-foreground">{group.title}</h3>
                      <p className="m-0 mt-1 font-mono text-[11px] text-muted-foreground">{group.pagePath}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill tone="cyan">{group.items.length} open</Pill>
                      {group.href ? (
                        <Button asChild variant="outline" size="xs">
                          <Link href={group.href}>Open page</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid gap-0">
                    {group.items.map((annotation) => (
                      <AnnotationRow key={annotation.id} annotation={annotation} />
                    ))}
                  </div>
                </section>
              ))}
            </section>
          ) : null}
        </section>
      )}

      {recentlyClosed.length > 0 ? (
        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="m-0 text-[15px] font-semibold text-foreground">Recently closed</h2>
            <span className="font-mono text-[11px] text-muted-foreground">{recentlyClosed.length}</span>
          </div>
          <Card className="gap-0 p-4">
            {recentlyClosed.map((annotation) => (
              <AnnotationRow key={annotation.id} annotation={annotation} compact />
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}
