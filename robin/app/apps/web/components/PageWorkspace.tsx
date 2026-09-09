import React from 'react';
import Link from 'next/link';
import type { RobinMeta } from '@robin/converter';
import { PrintButton } from '@/components/PrintButton';
import { PageMetaBar } from '@/components/vault/PageMetaBar';
import { ActiveDocumentRegistration } from '@/components/shell/ActiveDocumentProvider';

interface PageWorkspaceProps {
  title: string;
  summary?: string;
  meta: RobinMeta;
  renderPath: string;
  mtime: string;
  isTask: boolean;
  children: React.ReactNode;
}

/** "brain / tasks · task page" — a quiet locator above the ink title. */
function kickerFor(renderPath: string, type?: string): string {
  const parts = renderPath.replace(/\.html$/i, '').split('/');
  const dirs = parts.slice(0, -1);
  const loc = dirs.length ? dirs.join(' / ') : parts[0] ?? '';
  return type ? `${loc} · ${type} page` : loc;
}

/**
 * The one reading model.
 *
 * A single measured document canvas. Files live in the workspace sidebar;
 * source, write state, outline, connections, and history live in the global
 * Context drawer. The article keeps only its title, essential metadata, and
 * the body rendered as it sits on disk.
 */
export function PageWorkspace({
  title,
  summary,
  meta,
  renderPath,
  mtime,
  isTask,
  children,
}: PageWorkspaceProps): React.ReactElement {
  const isOutput = renderPath.startsWith('out/');

  return (
    <div className="r-vault-doc-grid">
      <ActiveDocumentRegistration
        path={renderPath}
        mode="view"
        writeState={isTask ? { kind: 'saved', at: mtime } : { kind: 'read-only' }}
        updatedAt={mtime}
      />
      <article className="r-vault-doc" data-robin-annotate-root>
        {isOutput ? (
          <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <PrintButton />
          </div>
        ) : null}

        <span className="r-vault-kicker">{kickerFor(renderPath, meta.type)}</span>
        <h1 className="r-vault-title">{title}</h1>
        {summary ? <p className="r-vault-summary">{summary}</p> : null}

        <PageMetaBar meta={meta} renderPath={renderPath} isTask={isTask} />

        {children}

        <p className="r-vault-endnote">
          — end of page ·{' '}
          <Link href={`/activity?path=${encodeURIComponent(renderPath)}`}>history ↗</Link>
        </p>
      </article>
    </div>
  );
}
