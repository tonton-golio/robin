import type React from 'react';

/**
 * Loading state — the tablist shape plus skeleton cards. No counts and no
 * summary numbers are drawn while data is in flight; a placeholder zero would
 * read as a real reading.
 */
export function CandidatesSkeleton(): React.ReactElement {
  return (
    <div className="cand-page cand-skel" aria-busy="true" aria-label="Loading candidates">
      <span className="r-bar">Candidates</span>
      <div className="cand-tabs" aria-hidden="true">
        <span className="cand-tab is-active">Kanban</span>
        <span className="cand-tab">Table</span>
      </div>
      <div className="cand-skel-board">
        {Array.from({ length: 4 }).map((_, col) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
          <div className="cand-skel-col" key={col}>
            <div className="sk sk-head" />
            {Array.from({ length: 3 }).map((__, row) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
              <div className="sk sk-card" key={row} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
