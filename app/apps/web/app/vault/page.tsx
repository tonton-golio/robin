import Link from 'next/link';
import { FolderTree, ArrowRight } from 'lucide-react';
import { VaultTree } from '@/components/vault/VaultTree';
import { listBrainPages, pageHref } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export default async function VaultPage() {
  const pages = await listBrainPages();
  const recent = pages
    .slice()
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, 12);

  return (
    <div className="vault-shell">
      <VaultTree />
      <div className="vault-viewer">
        <div className="vault-viewer-inner">
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--robin-amber)', textTransform: 'uppercase' }}>
            Vault
          </p>
          <h1 className="vault-h1">Pick a page to read.</h1>
          <p style={{ color: 'var(--text-1)', fontSize: 15, lineHeight: 1.55, marginBottom: 28 }}>
            Browse the tree on the left, or jump in with{' '}
            <kbd style={{ background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4, fontSize: 12, fontFamily: 'var(--font-mono)' }}>⌘K</kbd>.
            The vault holds <strong style={{ color: 'var(--text-0)' }}>{pages.length}</strong> brain pages — every page links back to its sources.
          </p>

          <div style={{ marginTop: 36 }}>
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
              Recently updated
            </h2>
            <div className="today-list">
              {recent.map((p) => (
                <Link key={p.path} href={pageHref(p.path)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--signal-cyan)', display: 'inline-block' }} />
                    {p.title}
                  </span>
                  <span className="today-list-meta">{p.type}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
