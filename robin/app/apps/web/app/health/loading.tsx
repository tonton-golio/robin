// Skeleton matching the real health layout (BUILD-BRIEF §9): overall block,
// 7 strip tiles, triage rows, and two scanner metric blocks — the same regions
// in the same places so nothing reflows when data lands. Pulse is disabled
// under prefers-reduced-motion (page-health.css).

export default function HealthLoading() {
  return (
    <div className="health-page" aria-busy="true" aria-live="polite">
      <span className="health-sr-only">Loading health snapshot…</span>
      <span className="h-bar">Health</span>

      <div className="health-sk h-overall-sk" />

      <div className="health-sk-strip">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="health-sk h-tile-sk" />
        ))}
      </div>

      <div className="health-sk-triage">
        <div className="health-sk h-line" style={{ width: 220, height: 14 }} />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="health-sk h-row-sk" />
        ))}
      </div>

      {Array.from({ length: 2 }).map((_, s) => (
        <div key={s} className="health-sk-scanner">
          <div className="health-sk h-line" style={{ width: 260, height: 24, marginBottom: 12 }} />
          <div className="health-sk-metrics">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="health-sk h-metric-sk" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
