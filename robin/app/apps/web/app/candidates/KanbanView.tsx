'use client';

import type React from 'react';
import {
  type Candidate,
  DATE_KIND_LABEL,
  flagClass,
  flagLabel,
  formatDate,
  groupByStage,
  ownerClass,
  ownerLabel,
  type Pipeline,
  primaryDate,
} from './model';

/**
 * Board view — one column per declared stage, in declared order.
 *
 * Deliberately read-only: there is no drag handle and no drop target, because
 * moving a candidate here would not move them in Workable. The board is a
 * reading of the snapshot, not a controller for it.
 */
function CandidateCard({ c }: { c: Candidate }): React.ReactElement {
  const date = primaryDate(c);
  return (
    <article className="cand-card">
      <h3 className="cand-name">{c.name}</h3>
      {c.awaiting ? <p className="cand-await">{c.awaiting}</p> : null}
      <p className="cand-dates">
        <span className="cand-dk">{DATE_KIND_LABEL[date.kind]}</span>
        <span className="cand-dv">{formatDate(date.value)}</span>
      </p>
      <div className="cand-chips">
        <span className={ownerClass(c.owner)}>{ownerLabel(c.owner)}</span>
        {c.flag ? <span className={flagClass(c.flag)}>{flagLabel(c.flag)}</span> : null}
      </div>
      {c.notes ? (
        <details className="cand-notes">
          <summary>Notes</summary>
          <p>{c.notes}</p>
        </details>
      ) : null}
    </article>
  );
}

export function KanbanView({ pipeline }: { pipeline: Pipeline }): React.ReactElement {
  const columns = groupByStage(pipeline);
  return (
    <div className="cand-board">
      {columns.map((col) => (
        <section className="cand-col" key={col.stage.key} aria-label={col.stage.label}>
          <header className="cand-colhead">
            <span className="r-bar">{col.stage.label}</span>
            <span className="cand-colcount">{col.candidates.length}</span>
          </header>
          <div className="cand-cards">
            {col.candidates.length === 0 ? (
              <p className="cand-colempty">Nobody here</p>
            ) : (
              col.candidates.map((c) => <CandidateCard c={c} key={`${col.stage.key}-${c.name}`} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
