'use client';

/** Skeleton rows while the board loads (rollup/tabs/controls hidden). */
export function LoadingState() {
  return (
    <div className="tk-skel" aria-busy="true" aria-label="Loading tasks">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="tk-skelrow">
          <div className="tk-sk" style={{ width: `${55 - i * 4}%` }} />
          <div className="tk-sk" style={{ width: `${30 + i * 3}%`, marginTop: 8, height: 9 }} />
        </div>
      ))}
    </div>
  );
}

/** Real-zero empty state — never confusable with an error. */
export function EmptyState({
  parsed,
  filtered,
  onClearFilters,
}: {
  parsed: number;
  filtered: number;
  onClearFilters: () => void;
}) {
  const blamesFilter = parsed > 0 && filtered === 0;
  return (
    <div className="tk-statebox">
      <span className="r-bar">Nothing here</span>
      <div className="tk-sb-t">nothing here — and that is a real zero</div>
      <p>
        {blamesFilter
          ? 'The index read fine; the active filters just exclude everything. Clear them to see the plan, or start a new task.'
          : 'No task pages parsed under brain/tasks. Create the first one to start the plan.'}
      </p>
      <div className="tk-sb-m r-mono">
        read: brain/tasks/*.html · {parsed} parsed · {filtered} after filter
      </div>
      <div className="tk-sb-btns">
        {blamesFilter ? (
          <button className="r-btn" onClick={onClearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Error state — states the failing call, that the index was NOT read. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="tk-statebox err" role="alert">
      <span className="r-bar tk-bar-err">Board unavailable</span>
      <div className="tk-sb-t">the board could not load</div>
      <p>
        <span className="r-mono">GET /api/tasks/board → {message}</span>. The task index was NOT read, so this empty
        view is deliberate — not a stale board and not a real zero.
      </p>
      <div className="tk-sb-btns">
        <button className="r-btn" onClick={onRetry}>
          Retry
        </button>
        <a className="r-btn r-btn--ghost" href="/health">
          Open Health → indexer
        </a>
      </div>
    </div>
  );
}

/** Overloaded strip — windows the tree / caps the board, nudges toward filters. */
export function OverloadStrip({ total, shown }: { total: number; shown: number }) {
  return (
    <div className="tk-overloadstrip">
      <span>
        {total} leaves match — rendering first {shown}.
      </span>
      <span className="tk-os-m r-mono">scroll or narrow by outcome / owner / search</span>
    </div>
  );
}
