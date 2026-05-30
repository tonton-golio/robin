import { notFound, redirect } from 'next/navigation';
import { readPage } from '@/lib/read-page';
import { buildSlugMap, resolveWikilinkHrefs, resolveSlug, dedupeBodyHeadings } from '@/lib/read-page';
import { locateVault } from '@/lib/vault';
import { normalizeVaultFilePath } from '@/lib/vault-file';
import { vaultApiFileHref, vaultPageHref } from '@/lib/routes';
import type { WikiLinkMap } from '@/lib/blocks-to-react';
import type { Metadata } from 'next';
import { LogView } from './LogView';
import { AccessBeacon } from './AccessBeacon';
import { FlowPageView } from '@/components/FlowPageView';
import { PageWorkspace } from '@/components/PageWorkspace';
import { ArtifactWorkspace } from '@/components/artifact/ArtifactWorkspace';

interface PageProps {
  params: Promise<{ path: string[] }>;
}

function isStandaloneArtifact(page: { blocks: unknown[]; bodyHtml: string; filePath: string }): boolean {
  return page.filePath.startsWith('out/') && page.blocks.length === 0 && !page.bodyHtml.trim();
}

/**
 * Dynamic page route: /p/[...path]
 *
 * Special routes:
 *   /p/_logs/changelog  → render logs/changelog.md via marked()
 *   /p/_logs/ingest     → render logs/ingest-log.md via marked()
 *
 * Normal routes:
 *   /p/brain/_index  → reads <vault>/brain/_index.html
 *   /p/logs/meetings/foo  → reads <vault>/logs/meetings/foo.html
 */
export default async function PageRoute({ params }: PageProps) {
  const { path: segments } = await params;

  // Handle log routes
  if (segments[0] === '_logs') {
    const logFile = segments[1] ?? 'changelog';
    return <LogView file={logFile} />;
  }

  const vaultRelativePath = segments.join('/') + '.html';
  const vault = locateVault();

  // Build slug map for wikilink resolution
  const slugMap = await buildSlugMap(vault);

  const wikimap: WikiLinkMap = {
    resolve(slug: string) {
      const p = resolveSlug(slugMap, slug);
      if (!p) return null;
      const archived = p.includes('/archive/');
      return { path: p, archived };
    },
  };

  // Run the same allowlist + deny-list + null-byte guard the /file and /api/file
  // routes use before touching the filesystem. readPage joins straight onto the
  // vault root, so without this the route would render off-allowlist/sensitive
  // paths (e.g. inbox/contracts) that the file routes reject. A null result is
  // treated like a missing page (it still gets the single-segment slug fallback
  // below — bare slugs like /robin-gist legitimately fail this guard).
  const safePath = normalizeVaultFilePath(vaultRelativePath);
  let page = safePath
    ? await readPage(safePath)
    : ({ error: 'not_found', filePath: vaultRelativePath } as const);

  // Slug-only fallback: a single-segment URL like /some-page-slug can be a slug
  // reference from a wikilink. Look it up in the slug map and redirect to the
  // canonical vault path.
  if ('error' in page && page.error === 'not_found' && segments.length === 1) {
    const resolved = slugMap.get(segments[0]!);
    if (resolved) {
      redirect(vaultPageHref(resolved));
    }
  }

  if ('error' in page) {
    if (page.error === 'not_found') notFound();
    // For parse errors, show an error page
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-red-400 mb-2">Parse Error</h1>
          <p className="text-slate-400 text-sm">{page.error}</p>
          <p className="text-slate-500 text-xs mt-1">{vaultRelativePath}</p>
        </div>
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

  return (
    <>
      {/* Fire access beacon on mount — increments rolling counter in index */}
      <AccessBeacon path={vaultRelativePath} />

      <PageWorkspace
        title={page.title}
        summary={page.meta.summary}
        renderPath={page.filePath}
        mtime={page.mtime.toISOString()}
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
    const name =
      segments[1] === 'ingest' ? 'Ingest Log' :
      segments[1] === 'repo' ? 'Repo Log' :
      'Changelog';
    return { title: `${name} — Robin` };
  }

  const vaultRelativePath = segments.join('/') + '.html';
  const safePath = normalizeVaultFilePath(vaultRelativePath);
  if (!safePath) {
    return { title: 'Not found — Robin' };
  }
  const page = await readPage(safePath);

  if ('error' in page) {
    return { title: 'Not found — Robin' };
  }

  return {
    title: `${page.title} — Robin`,
    description: page.meta.summary,
  };
}
