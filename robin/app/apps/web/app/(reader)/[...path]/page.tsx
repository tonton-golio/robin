import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { readPage } from '@/lib/read-page';
import { buildSlugMap, resolveWikilinkHrefs, resolveSlug, dedupeBodyHeadings } from '@/lib/read-page';
import { locateVault } from '@/lib/vault';
import { normalizeVaultFilePath } from '@/lib/vault-file';
import { vaultApiFileHref, vaultFileHref, vaultPageHref } from '@/lib/routes';
import type { WikiLinkMap } from '@/lib/blocks-to-react';
import type { Metadata } from 'next';
import { LogView } from './LogView';
import { AccessBeacon } from './AccessBeacon';
import { FlowPageView } from '@/components/FlowPageView';
import { PageWorkspace } from '@/components/PageWorkspace';
import { ArtifactWorkspace } from '@/components/artifact/ArtifactWorkspace';
import { ActiveDocumentRegistration } from '@/components/shell/ActiveDocumentProvider';
import { isArchivePath } from '@/lib/archive';
import { resolveMovedHtmlPath } from '@/lib/moved-path';

interface PageProps {
  params: Promise<{ path: string[] }>;
}

function isStandaloneArtifact(page: { blocks: unknown[]; bodyHtml: string; filePath: string }): boolean {
  return page.filePath.startsWith('out/') && page.blocks.length === 0 && !page.bodyHtml.trim();
}

/**
 * The vault document reader: /<vault-path> (brain / inbox / out / logs).
 *
 * Special routes:
 *   /_logs/changelog|ingest|repo → markdown log viewer
 *   /out/<artifact>              → standalone artifact workspace (self-contained HTML)
 *
 * Everything else renders through the one reading model (PageWorkspace +
 * FlowPageView) inside the persistent (reader) layout, so the tree survives.
 */
export default async function PageRoute({ params }: PageProps) {
  const { path: segments } = await params;

  if (segments[0] === '_logs') {
    const logFile = segments[1] ?? 'changelog';
    return <LogView file={logFile} />;
  }

  const vaultRelativePath = segments.join('/') + '.html';
  const vault = locateVault();

  const slugMap = await buildSlugMap(vault);
  const wikimap: WikiLinkMap = {
    resolve(slug: string) {
      const p = resolveSlug(slugMap, slug);
      if (!p) return null;
      const archived = isArchivePath(p);
      return { path: p, archived };
    },
  };

  // Path allowlist + null-byte guard, matching the /file + /api/file routes.
  const safePath = normalizeVaultFilePath(vaultRelativePath);
  const page = safePath
    ? await readPage(safePath)
    : ({ error: 'not_found', filePath: vaultRelativePath } as const);

  // Slug-only fallback: a single-segment URL can be a wikilink slug.
  if ('error' in page && page.error === 'not_found' && segments.length === 1) {
    const resolved = slugMap.get(segments[0]!);
    if (resolved) redirect(vaultPageHref(resolved));
  }

  if ('error' in page && page.error === 'not_found' && safePath) {
    const movedPath = await resolveMovedHtmlPath(safePath);
    if (movedPath) redirect(vaultPageHref(movedPath));
  }

  if ('error' in page) {
    if (page.error === 'not_found') notFound();
    // Read error — the file exists but failed to parse (e.g. an injected control
    // byte from a parallel edit). Content is UNKNOWN, not zero. Signal-red box.
    return (
      <div className="r-vault-doc-grid">
        <ActiveDocumentRegistration
          path={vaultRelativePath}
          mode="view"
          writeState={{ kind: 'read-only' }}
        />
        <article className="r-vault-doc">
          <div className="r-vault-statebox warn" role="alert">
            <span className="warnpill">Read error</span>
            <div className="st">Can&rsquo;t render this page.</div>
            <p>
              The file exists but failed to parse as ROBIN_FORMAT. This is not an empty page — the content is unknown,
              not zero. Scan changed files for control bytes before committing.
            </p>
            <div className="m">
              {vaultRelativePath} · {page.error}
            </div>
            <div className="actions">
              <Link className="r-btn" href={vaultFileHref(vaultRelativePath)}>
                Open raw ↗
              </Link>
              <Link className="r-btn r-btn--danger" href="/health">
                Report to Health
              </Link>
            </div>
          </div>
        </article>
      </div>
    );
  }

  if (isStandaloneArtifact(page)) {
    return (
      <ArtifactWorkspace
        title={page.title}
        filePath={page.filePath}
        pagePath={vaultRelativePath}
        fileUrl={vaultApiFileHref(page.filePath)}
        mtime={page.mtime.toISOString()}
      />
    );
  }

  const isTask = page.meta.type === 'task' && page.filePath.startsWith('brain/tasks/');

  return (
    <>
      <AccessBeacon path={vaultRelativePath} />
      <PageWorkspace
        title={page.title}
        summary={page.meta.summary}
        meta={page.meta}
        renderPath={page.filePath}
        mtime={page.mtime.toISOString()}
        isTask={isTask}
      >
        <FlowPageView
          blocks={page.blocks}
          meta={page.meta}
          wikimap={wikimap}
          bodyHtml={dedupeBodyHeadings(resolveWikilinkHrefs(page.bodyHtml, slugMap), page.title)}
        />
      </PageWorkspace>
    </>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { path: segments } = await params;

  if (segments[0] === '_logs') {
    const name = segments[1] === 'ingest' ? 'Ingest Log' : segments[1] === 'repo' ? 'Repo Log' : 'Changelog';
    return { title: `${name} — Robin` };
  }

  const vaultRelativePath = segments.join('/') + '.html';
  const safePath = normalizeVaultFilePath(vaultRelativePath);
  if (!safePath) return { title: 'Not found — Robin' };
  const page = await readPage(safePath);
  if ('error' in page) return { title: 'Not found — Robin' };
  return { title: `${page.title} — Robin`, description: page.meta.summary };
}
