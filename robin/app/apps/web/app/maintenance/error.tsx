'use client';

import { useEffect } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';
import { PageHeader, Card, Button } from '@/components/ui';

/**
 * Error boundary for the maintenance route. The page runs several vault scans
 * (lint, wiki integrity, tasks, memory, outputs); an unhandled throw in any of
 * them would otherwise replace the view with Next's raw runtime-error screen.
 * This renders a recoverable in-app card whose Retry re-runs the failed render.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the failure for debugging; the digest links the client error to
    // the server log entry in production.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 pb-16 sm:px-14" role="alert">
      <PageHeader
        eyebrow="Maintenance"
        title="Could not load the maintenance snapshot."
        sub="A vault scan failed to complete. Your vault is fine — this is just the view."
      />
      <Card className="gap-3 border-l-[3px] border-l-[var(--warning-rust)] p-4">
        <div className="flex items-center gap-2 text-foreground">
          <AlertOctagon size={15} strokeWidth={1.5} style={{ color: 'var(--warning-rust)' }} />
          <span className="font-mono text-[13px]">
            {error.message || 'Unexpected error'}
            {error.digest ? ` (${error.digest})` : ''}
          </span>
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            <RotateCcw size={14} strokeWidth={1.5} /> Try again
          </Button>
        </div>
      </Card>
    </div>
  );
}
