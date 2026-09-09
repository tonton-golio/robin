'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { useCallback } from 'react';
import { EmptyState, PageHeader } from '@/components/ui';
import { KanbanView } from './KanbanView';
import { formatDate, type Pipeline, summarise } from './model';
import { TableView } from './TableView';

type View = 'kanban' | 'table';
const VIEWS: View[] = ['kanban', 'table'];

/**
 * Candidates — the hiring pipeline tracker.
 *
 * Two views over one snapshot. Both are mounted at all times (`hidden` on the
 * inactive one) so switching never re-runs a layout pass or loses a scroll
 * position, and the choice is mirrored into `?view=` so a view is linkable.
 *
 * Read-only by design: Workable is the system of record, so there is no drag,
 * no inline edit and no write path here. The header says so out loud.
 */
export function CandidatesView({
  pipeline,
  sourcePath,
}: {
  pipeline: Pipeline | null;
  sourcePath: string;
}): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const viewParam = searchParams.get('view');
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : 'kanban';

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setView = useCallback((v: View) => setParam({ view: v }), [setParam]);

  if (!pipeline) {
    return (
      <div className="cand-page">
        <PageHeader eyebrow="Hiring" title="Candidates" sub="No pipeline snapshot to read yet." />
        <EmptyState
          title="No pipeline snapshot"
          hint={
            <>
              Expected a hiring snapshot at <span className="r-mono">{sourcePath}</span> in the
              vault. Nothing is inferred when it is missing — ask Robin to refresh the snapshot from
              Workable.
            </>
          }
        />
      </div>
    );
  }

  const s = summarise(pipeline.candidates);
  const eyebrow = pipeline.workableRef
    ? `${pipeline.role} · ${pipeline.workableRef}`
    : pipeline.role;

  return (
    <div className="cand-page">
      <PageHeader
        eyebrow={eyebrow}
        title="Candidates"
        sub={
          <>
            Hand-taken snapshot of {formatDate(pipeline.syncedAt)}, not a live feed — a stage here
            can already be stale. {pipeline.note ?? 'Workable remains the system of record.'}
          </>
        }
        actions={
          pipeline.workableUrl ? (
            <a
              className="r-btn r-btn--ghost cand-open"
              href={pipeline.workableUrl}
              rel="noreferrer noopener"
            >
              Open in Workable ↗
            </a>
          ) : null
        }
      />

      {/* summary strip — five readings over the same snapshot */}
      <div className="cand-sum" aria-label="Pipeline summary">
        <div className="cand-stat">
          <span className="cand-stat-n">{s.total}</span>
          <span className="cand-stat-l">In pipeline</span>
        </div>
        <div className="cand-stat">
          <span className="cand-stat-n">{s.waitingOwner}</span>
          <span className="cand-stat-l">Waiting on you</span>
        </div>
        <div className="cand-stat">
          <span className="cand-stat-n">{s.waitingCandidate}</span>
          <span className="cand-stat-l">Waiting on candidate</span>
        </div>
        <div className="cand-stat">
          <span className="cand-stat-n">{s.active}</span>
          <span className="cand-stat-l">Active</span>
        </div>
        <div className="cand-stat">
          <span className="cand-stat-n">{s.closed}</span>
          <span className="cand-stat-l">Closed</span>
        </div>
      </div>

      <div className="cand-tabs" role="tablist" aria-label="Candidates view">
        <button
          className="cand-tab"
          id="cand-tab-kanban"
          role="tab"
          type="button"
          aria-selected={view === 'kanban'}
          aria-controls="cand-panel-kanban"
          onClick={() => setView('kanban')}
        >
          Kanban
        </button>
        <button
          className="cand-tab"
          id="cand-tab-table"
          role="tab"
          type="button"
          aria-selected={view === 'table'}
          aria-controls="cand-panel-table"
          onClick={() => setView('table')}
        >
          Table
        </button>
      </div>

      <div
        id="cand-panel-kanban"
        role="tabpanel"
        aria-labelledby="cand-tab-kanban"
        hidden={view !== 'kanban'}
      >
        <KanbanView pipeline={pipeline} />
      </div>
      <div
        id="cand-panel-table"
        role="tabpanel"
        aria-labelledby="cand-tab-table"
        hidden={view !== 'table'}
      >
        <TableView pipeline={pipeline} setParam={setParam} />
      </div>

      <footer className="cand-foot">
        <span className="r-mono">
          source: {sourcePath} · synced {pipeline.syncedAt ?? 'unknown'}
          {pipeline.syncedFrom.length > 0 ? ` · from ${pipeline.syncedFrom.join(', ')}` : ''}
        </span>
        {pipeline.challengePlatform ? (
          <a
            className="r-mono cand-src"
            href={pipeline.challengePlatform}
            rel="noreferrer noopener"
          >
            {pipeline.challengePlatform}
          </a>
        ) : null}
      </footer>
    </div>
  );
}
