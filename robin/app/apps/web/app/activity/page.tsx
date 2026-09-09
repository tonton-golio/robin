import type { Metadata } from 'next';
import { Suspense } from 'react';
import { loadActivity } from './load';
import { ActivityView } from './ActivityView';
import { ActivitySkeleton } from './ActivitySkeleton';

// Reads the append-only edit/annotation/ingest/session streams straight off the
// filesystem in an async Server Component; force dynamic so it never serves a
// build-time snapshot of the ledger.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Activity · Robin',
  description: 'The agent ledger — edits, comments, sessions, and ingest in one time-ordered surface.',
};

async function ActivityLoader() {
  const data = await loadActivity();
  return <ActivityView data={data} />;
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<ActivitySkeleton />}>
      <ActivityLoader />
    </Suspense>
  );
}
