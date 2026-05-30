'use client';

import { useEffect } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';

/**
 * Error boundary for the home dashboard. Because home is the app's landing
 * route, an unhandled throw in the today-snapshot pipeline would otherwise
 * replace the whole app with Next's raw runtime-error screen. This renders a
 * graceful in-app card with a retry that re-runs the failed server render.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the failure in the console for debugging; the digest links the
    // client error to the server log entry in production.
    console.error(error);
  }, [error]);

  return (
    <div className="today-page" role="alert">
      <div className="today-hero">
        <span className="today-date" style={{ color: 'var(--warning-rust)' }}>
          dashboard unavailable
        </span>
        <h1 className="today-title">Something broke loading today.</h1>
        <p className="today-sub">
          A data source for the dashboard failed to load. Your vault is fine — this is
          just the view.
        </p>
      </div>

      <section className="today-card">
        <div className="today-card-body" style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-1)' }}>
            <AlertOctagon size={15} strokeWidth={1.5} style={{ color: 'var(--warning-rust)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              {error.message || 'Unexpected error'}
              {error.digest ? ` (${error.digest})` : ''}
            </span>
          </div>
          <div>
            <button
              type="button"
              onClick={reset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                color: 'var(--robin-amber)',
                background: 'transparent',
                border: '1px solid color-mix(in srgb, var(--robin-amber) 45%, var(--border-0))',
                borderRadius: 6,
                padding: '7px 12px',
                cursor: 'pointer',
              }}
            >
              <RotateCcw size={14} strokeWidth={1.5} /> Try again
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
