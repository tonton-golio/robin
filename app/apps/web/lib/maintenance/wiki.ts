import path from 'path';
import { listBrainPages, pageHref, type CatalogPage } from '@/lib/catalog';
import { readPage } from '@/lib/read-page';
import { locateVault } from '@/lib/vault';
import type { MaintenanceItem, Severity } from './types';
import { metaContent, isValidDate, readText, severityRank, titleFromPath, walk } from './shared';

export interface WikiSection {
  title: string;
  source: string;
  pagesScanned: number;
  parseErrors: number;
  brokenWikilinkCount: number;
  orphanCount: number;
  metaIssueCount: number;
  brokenWikilinks: WikiLinkIssue[];
  orphans: OrphanPage[];
  metaIssues: MetaIssue[];
}

export interface WikiLinkIssue {
  fromPath: string;
  fromTitle: string;
  missingSlug: string;
  href: string;
  severity: Severity;
}

export interface OrphanPage {
  path: string;
  title: string;
  slug: string;
  type: string;
  updated?: string;
  href: string;
  severity: Severity;
}

export interface MetaIssue {
  path: string;
  title?: string;
  issue: string;
  detail?: string;
  severity: Severity;
  href: string;
}

export async function getWikiSection(limit: number): Promise<WikiSection> {
  const [pages, meta] = await Promise.all([
    listBrainPages(),
    scanBrainMetaIssues(),
  ]);

  const slugSet = new Set(pages.map((page) => page.slug));
  const inbound = new Map<string, number>();
  const broken: WikiLinkIssue[] = [];

  // Path-like wikilinks (e.g. [[features/images]] or [[people/team/_index]])
  // resolve against a page's vault-relative path, not its bare slug. Map each
  // page's extension-less path to its slug so these resolve and count as
  // inbound — otherwise they flood the lint as false-positive broken links.
  const pathToSlug = new Map<string, string>();
  for (const page of pages) {
    pathToSlug.set(page.path.replace(/\.html$/, ''), page.slug);
  }

  // Brain pages can legitimately link into out/ and inbox/ (e.g. archived
  // sources and generated outputs). Include those HTML files in the resolution
  // sets so such links don't register as broken — matching the canonical
  // vault.lint, which resolves against the whole vault, not just brain/.
  const vault = locateVault();
  for (const relDir of ['out', 'inbox']) {
    const files = (await walk(vault, relDir)).filter((file) => file.endsWith('.html'));
    for (const relFile of files) {
      const noExt = relFile.replace(/\.html$/, '');
      const slug = path.basename(noExt);
      if (!pathToSlug.has(noExt)) pathToSlug.set(noExt, slug);
      slugSet.add(slug);
    }
  }

  // Returns the resolved page slug for a wikilink target, or undefined if the
  // target matches no known page. Bare targets match by slug; path-like targets
  // match a page path exactly or by trailing path segment (suffix match).
  const resolveTarget = (target: string): string | undefined => {
    if (target.includes('/')) {
      for (const [pagePath, slug] of pathToSlug) {
        if (pagePath === target || pagePath.endsWith(`/${target}`)) return slug;
      }
      return undefined;
    }
    return slugSet.has(target) ? target : undefined;
  };

  for (const page of pages) {
    for (const slug of page.links) {
      const resolved = resolveTarget(slug);
      if (resolved) {
        inbound.set(resolved, (inbound.get(resolved) ?? 0) + 1);
      } else {
        broken.push({
          fromPath: page.path,
          fromTitle: page.title,
          missingSlug: slug,
          href: pageHref(page.path),
          severity: 'warning',
        });
      }
    }
  }

  const orphans = pages
    .filter((page) => isOrphanCandidate(page) && (inbound.get(page.slug) ?? 0) === 0)
    .map((page): OrphanPage => ({
      path: page.path,
      title: page.title,
      slug: page.slug,
      type: page.type,
      updated: page.updated,
      href: pageHref(page.path),
      severity: page.type === 'task' ? 'info' : 'warning',
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    title: 'Wiki integrity',
    source: 'brain/**/*.html',
    pagesScanned: pages.length,
    parseErrors: meta.parseErrors,
    brokenWikilinkCount: broken.length,
    orphanCount: orphans.length,
    metaIssueCount: meta.issues.length,
    brokenWikilinks: broken.sort((a, b) => a.fromPath.localeCompare(b.fromPath)).slice(0, limit),
    orphans: orphans.slice(0, limit),
    metaIssues: meta.issues.slice(0, limit),
  };
}

export function wikiLinkItem(item: WikiLinkIssue): MaintenanceItem {
  return {
    id: `broken-link:${item.fromPath}:${item.missingSlug}`,
    title: `Missing wikilink: ${item.missingSlug}`,
    detail: `Referenced from ${item.fromTitle}.`,
    path: item.fromPath,
    href: item.href,
    severity: item.severity,
  };
}

export function orphanItem(item: OrphanPage): MaintenanceItem {
  return {
    id: `orphan:${item.path}`,
    title: `Orphan page: ${item.title}`,
    detail: 'No inbound wikilinks found.',
    path: item.path,
    href: item.href,
    meta: [item.type, item.updated].filter((value): value is string => Boolean(value)),
    severity: item.severity,
  };
}

export function metaIssueItem(item: MetaIssue): MaintenanceItem {
  return {
    id: `meta:${item.path}:${item.issue}:${item.detail ?? ''}`,
    title: item.issue,
    detail: item.detail,
    path: item.path,
    href: item.href,
    meta: item.title ? [item.title] : undefined,
    severity: item.severity,
  };
}

async function scanBrainMetaIssues(): Promise<{ issues: MetaIssue[]; parseErrors: number }> {
  const vault = locateVault();
  const relFiles = (await walk(vault, 'brain')).filter((file) => file.endsWith('.html'));
  const issues: MetaIssue[] = [];
  let parseErrors = 0;

  for (const relFile of relFiles) {
    const absPath = path.join(vault, relFile);
    const html = await readText(absPath);
    const page = await readPage(relFile);
    const href = pageHref(relFile);

    if ('error' in page) {
      parseErrors += 1;
      issues.push({
        path: relFile,
        issue: page.error,
        severity: 'critical',
        href,
      });
      continue;
    }

    const title = page.title || titleFromPath(relFile);
    const slug = metaContent(html, 'robin:slug');
    const updated = metaContent(html, 'robin:updated');
    const summary = metaContent(html, 'robin:summary');
    const metaPath = metaContent(html, 'robin:path');
    const type = metaContent(html, 'robin:type');

    if (!page.title.trim()) {
      issues.push({ path: relFile, title, issue: 'missing title', severity: 'warning', href });
    }
    if (!slug) {
      issues.push({ path: relFile, title, issue: 'missing robin:slug', severity: 'warning', href });
    }
    if (!type) {
      issues.push({ path: relFile, title, issue: 'missing robin:type', severity: 'warning', href });
    }
    if (!summary && !relFile.endsWith('/_index.html') && !relFile.endsWith('brain/_index.html')) {
      issues.push({ path: relFile, title, issue: 'missing robin:summary', severity: 'info', href });
    }
    if (!updated) {
      issues.push({ path: relFile, title, issue: 'missing robin:updated', severity: 'warning', href });
    } else if (!isValidDate(updated)) {
      issues.push({ path: relFile, title, issue: 'invalid robin:updated', detail: updated, severity: 'warning', href });
    }
    if (metaPath && metaPath !== relFile) {
      issues.push({
        path: relFile,
        title,
        issue: 'robin:path mismatch',
        detail: metaPath,
        severity: 'warning',
        href,
      });
    }
  }

  return {
    parseErrors,
    issues: issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.path.localeCompare(b.path)),
  };
}

function isOrphanCandidate(page: CatalogPage): boolean {
  if (page.path.endsWith('/_index.html') || page.path === 'brain/_index.html') return false;
  if (page.path.includes('/archive/')) return false;
  return page.type !== 'task';
}
