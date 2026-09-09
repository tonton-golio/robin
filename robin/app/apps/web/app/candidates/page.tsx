import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CandidatesSkeleton } from './CandidatesSkeleton';
import { CandidatesView } from './CandidatesView';
import { loadPipeline, PIPELINE_REL_PATH } from './load';

// Reads the hiring snapshot off the filesystem in an async Server Component, so
// force dynamic: a build-time copy of a pipeline would be worse than no page.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Candidates · Robin',
  description: 'Hiring pipeline tracker — a manual snapshot of the Workable pipeline.',
};

async function CandidatesLoader() {
  const pipeline = await loadPipeline();
  return <CandidatesView pipeline={pipeline} sourcePath={PIPELINE_REL_PATH} />;
}

export default function CandidatesPage() {
  return (
    <Suspense fallback={<CandidatesSkeleton />}>
      <CandidatesLoader />
    </Suspense>
  );
}
