import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { SearchView } from './SearchView';

export const metadata: Metadata = {
  title: 'Search — Robin',
  description: 'The durable full-results surface over the vault index.',
};

/**
 * Search — the durable results surface behind ⌘K.
 *
 * A server shell that hands off to the client `SearchView`. The client reads
 * `?q` (and the filter params) via `useSearchParams`, which Next requires to sit
 * under a Suspense boundary; the fallback mirrors the page's loading chrome so
 * the caption bar never flashes empty.
 */
export default function SearchPage(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <main className="srch" aria-busy="true">
          <span className="r-bar">Search</span>
        </main>
      }
    >
      <SearchView />
    </Suspense>
  );
}
