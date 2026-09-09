import React from 'react';

/**
 * Loading state — skeleton rows only. Filters and the since-block are hidden
 * until data lands (per spec §7). The pulse is off under reduced-motion via
 * the CSS in page-activity.css.
 */
export function ActivitySkeleton(): React.ReactElement {
  return (
    <div className="act-page act-skel" aria-busy="true" aria-label="Loading activity">
      <span className="r-bar">Activity</span>
      <div className="act-lenses" aria-hidden>
        <span className="act-lens is-active">Ledger</span>
        <span className="act-lens">Comments</span>
        <span className="act-lens">Sessions</span>
      </div>
      <div className="act-skel-list">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="act-skel-row" key={i}>
            <div className="sk sk-title" />
            <div className="sk sk-line" />
            <div className="sk sk-mono" />
          </div>
        ))}
      </div>
    </div>
  );
}
