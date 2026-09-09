'use client';

import React, { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AnnotationActions } from '@/components/annotations/AnnotationActions';
import { useRovingRows } from './useRovingRows';
import type { ActivityData, CommentRow } from './model';

const CLOSED = new Set(['resolved', 'rejected', 'archived', 'deleted', 'closed']);

function statusPillClass(status: string): string {
  if (status === 'needs-attention') return 'act-cpill--needs';
  if (status === 'resolved') return 'act-cpill--resolved';
  if (status === 'rejected' || status === 'deleted') return 'act-cpill--rejected';
  return 'act-cpill--open';
}

function statusLabel(status: string): string {
  if (status === 'needs-attention') return 'Needs attention';
  return status;
}

function CommentItem({ c }: { c: CommentRow }): React.ReactElement {
  return (
    <div
      className="act-crow"
      data-activity-row
      data-page-href={c.pageHref ?? ''}
      tabIndex={0}
      role="option"
      aria-selected={false}
      aria-label={`${c.status} comment on ${c.title}`}
    >
      <div className="act-crow-head">
        <span className={`act-cpill ${statusPillClass(c.status)}`}>{statusLabel(c.status)}</span>
        <span className="act-cpill act-cpill--kind">{c.kind}</span>
        <span className="act-crow-loc r-mono">{c.location}</span>
        {c.pageChanged ? (
          <button
            type="button"
            className="act-crow-stale"
            onClick={() => c.pageHref && (window.location.href = c.pageHref)}
          >
            ⚠ page changed — jump to anchor
          </button>
        ) : null}
      </div>

      {c.text ? <div className="act-crow-text">{c.text}</div> : null}
      {c.quote ? <blockquote className="act-crow-quote">{c.quote}</blockquote> : null}

      {c.resolutionMd || c.resultLink ? (
        <div className="act-crow-res">
          <b>Resolution</b>
          {c.resolutionMd ? <span>{c.resolutionMd}</span> : null}
          {c.resultLink ? <span className="r-mono">result_link: {c.resultLink}</span> : null}
        </div>
      ) : null}

      <div className="act-crow-prov r-prov">
        <span className="r-actor" data-who={c.origin}>
          {c.origin}
        </span>
        <span className="r-mono">
          {c.ts ? c.ts.replace('T', ' ').slice(0, 16) : ''} · {c.id}
        </span>
      </div>

      <div className="act-crow-actions">
        <AnnotationActions id={c.id} status={c.status} pagePath={c.path} />
        {c.pageHref ? (
          <a className="act-rowbtn" data-act="open" href={c.pageHref}>
            Open page<span className="act-rowbtn-key">o</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function CommentsLens({
  data,
  active,
}: {
  data: ActivityData;
  active: boolean;
}): React.ReactElement {
  const router = useRouter();

  const onRowKey = useCallback(
    (key: string, row: HTMLElement) => {
      if (key === 'r') row.querySelector<HTMLButtonElement>('button[data-act="resolve"]')?.click();
      else if (key === 'a')
        row.querySelector<HTMLButtonElement>('button[data-act="attention"]')?.click();
      else if (key === 'o' || key === 'Enter') {
        const href = row.dataset.pageHref;
        if (href) router.push(href);
      }
    },
    [router],
  );

  const { containerRef } = useRovingRows({ onRowKey, active });

  const { needsAttention, openByPage, closed } = useMemo(() => {
    const needs = data.comments.filter((c) => c.status === 'needs-attention');
    const open = data.comments.filter((c) => c.status === 'open');
    const closedRows = data.comments
      .filter((c) => CLOSED.has(c.status))
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 25);

    const byPage = new Map<string, { title: string; href: string | null; rows: CommentRow[] }>();
    for (const c of open) {
      const key = c.path || c.id;
      const g = byPage.get(key) ?? { title: c.title, href: c.pageHref, rows: [] };
      g.rows.push(c);
      byPage.set(key, g);
    }
    return {
      needsAttention: needs,
      openByPage: Array.from(byPage.entries()).map(([path, g]) => ({ path, ...g })),
      closed: closedRows,
    };
  }, [data.comments]);

  if (data.comments.length === 0) {
    return (
      <section aria-label="Comments">
        <div className="act-statebox">
          <span className="r-bar">Comments</span>
          <div className="act-statebox-t">no comments in the queue</div>
          <p>Pins and highlights left on vault pages and decks land here for triage.</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Comments" ref={containerRef}>
      {needsAttention.length > 0 ? (
        <div className="act-csection">
          <span className="r-bar">Needs attention · {needsAttention.length}</span>
          {needsAttention.map((c) => (
            <CommentItem c={c} key={c.id} />
          ))}
        </div>
      ) : null}

      {openByPage.length > 0 ? (
        <div className="act-csection">
          <span className="r-bar">Open by page</span>
          {openByPage.map((g) => (
            <div className="act-cpage" key={g.path}>
              <div className="act-cphead">
                <span className="act-cphead-t">{g.title}</span>
                <span className="act-cphead-p r-mono">{g.path}</span>
                <span className="act-cpage-pill">{g.rows.length} open</span>
                {g.href ? (
                  <a className="act-rowbtn act-cphead-open" href={g.href}>
                    Open page
                  </a>
                ) : null}
              </div>
              {g.rows.map((c) => (
                <CommentItem c={c} key={c.id} />
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {closed.length > 0 ? (
        <div className="act-csection">
          <span className="r-bar">Recently closed</span>
          {closed.map((c) => (
            <CommentItem c={c} key={c.id} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
