import type { Metadata } from 'next';
import Link from 'next/link';
import VaultLanding from '../vault/page';
import { readOverviewPages, selectThoughts } from '@/lib/overview';
import { locateVault } from '@/lib/vault';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Library — Robin' };

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const thoughtsView = (await searchParams).view === 'thoughts';
  const thoughts = thoughtsView ? selectThoughts((await readOverviewPages(locateVault(), ['brain'])).pages) : [];
  return <div className="r-library">
    <nav className="r-library-views" aria-label="Library views">
      <Link className="r-btn r-btn--ghost" href="/library" aria-current={!thoughtsView ? 'page' : undefined}>All knowledge</Link>{' '}
      <Link className="r-btn r-btn--ghost" href="/library?view=thoughts" aria-current={thoughtsView ? 'page' : undefined}>Thoughts to review</Link>
    </nav>
    {!thoughtsView ? <VaultLanding /> : <div className="r-vault-landing">
      <span className="kicker">Tentative knowledge</span>
      <h1 className="r-vault-title">Thoughts to review</h1>
      <p className="r-vault-summary">Proposals awaiting review. Open the source to assess its author, evidence and review trigger before treating it as a decision.</p>
      {thoughts.length === 0 ? <p>No thoughts currently need review.</p> : <div className="r-vault-recent">
        {thoughts.map((thought) => <section key={thought.path}>
          <Link href={thought.href}><span>{thought.title}</span><span className="meta">Tentative · needs review</span></Link>
          {thought.summary ? <p>{thought.summary}</p> : null}
          <p className="meta">Author: {thought.author ?? 'not recorded'} · Review trigger: {thought.reviewTrigger ?? 'not recorded; see source'}</p>
        </section>)}
      </div>}
    </div>}
  </div>;
}
