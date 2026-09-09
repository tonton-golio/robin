'use client';

// Envelope-level boundary ONLY (BUILD-BRIEF §7): a failure to load the
// shell/snapshot envelope itself. A single scanner throwing degrades inside the
// snapshot and never reaches here.

export default function HealthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="health-page">
      <span className="h-bar">Health</span>
      <div className="health-critcard" role="alert" style={{ marginTop: 18 }}>
        <div className="h-ch">
          <span className="h-dot is-crit" />
          <span className="h-ct">Health snapshot failed to load</span>
        </div>
        <p>
          The maintenance snapshot envelope threw before any scanner could render. This is an
          engine-level failure, not scanner drift.
        </p>
        <p className="h-mono" style={{ color: 'var(--red)' }}>
          {error.message}
        </p>
        <div className="h-crow">
          <button type="button" className="h-act" onClick={() => reset()}>
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
