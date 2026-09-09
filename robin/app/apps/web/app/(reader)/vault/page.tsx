import Link from 'next/link';
import { listBrainPages, pageHref } from '@/lib/catalog';
import { ActiveDocumentRegistration } from '@/components/shell/ActiveDocumentProvider';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Vault — Robin' };

/**
 * Library landing. The persistent shell owns the file tree; this page stays a
 * compact archive summary and recently-updated index.
 */
export default async function VaultLanding() {
  const pages = await listBrainPages();
  const tasks = pages.filter((p) => p.type === 'task').length;
  const decisions = pages.filter((p) => p.type === 'decision').length;
  const newest = pages.reduce<Date | null>((acc, p) => (!acc || p.mtime > acc ? p.mtime : acc), null);
  const recent = pages
    .slice()
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, 12);

  return (
    <div className="r-vault-landing">
      <ActiveDocumentRegistration
        path="brain/_index.html"
        mode="view"
        writeState={{ kind: 'read-only' }}
        updatedAt={newest?.toISOString()}
      />
      <span className="kicker">Living archive</span>
      <h1 className="r-vault-title">Library</h1>
      <p className="r-vault-summary">
        Browse durable knowledge as files. Robin shows the source and write
        state for every page you open.
      </p>

      <div className="r-vault-provstrip" aria-label="Index freshness">
        <span>
          index: <b>brain/_index.html</b>
        </span>
        {newest ? (
          <span>
            newest{' '}
            <b>
              {newest.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </b>
          </span>
        ) : null}
        <span>
          <b>{pages.length}</b> pages · <b>{tasks}</b> tasks · <b>{decisions}</b> decisions
        </span>
        <a className="r-btn r-btn--ghost" href="#resync">
          re-index
        </a>
      </div>

      <div className="r-vault-recent">
        <h2>Recently updated</h2>
        {recent.map((p) => (
          <Link key={p.path} href={pageHref(p.path)}>
            <span>{p.title}</span>
            <span className="meta">{p.type}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
