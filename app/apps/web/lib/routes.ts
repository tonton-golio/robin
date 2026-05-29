export interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface VaultRootMeta {
  label: string;
  overviewHref: string;
}

const VAULT_ROOTS: Record<string, VaultRootMeta> = {
  brain: { label: 'brain', overviewHref: '/vault' },
  inbox: { label: 'vault', overviewHref: '/vault' },
  logs: { label: 'daily', overviewHref: '/daily' },
  out: { label: 'outputs', overviewHref: '/outputs' },
};

function normalizePathValue(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function prettify(value: string): string {
  return safeDecode(value).replace(/[-_]+/g, ' ');
}

export function stripHtmlExtension(pathValue: string): string {
  return pathValue.replace(/\.html$/i, '');
}

export function encodePathSegments(pathValue: string): string {
  return normalizePathValue(pathValue)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

export function vaultPageHref(relPath: string): string {
  const encoded = encodePathSegments(stripHtmlExtension(relPath));
  return encoded ? `/${encoded}` : '/';
}

export function vaultFileHref(relPath: string): string {
  const encoded = encodePathSegments(relPath);
  return encoded ? `/file/${encoded}` : '/file';
}

export function vaultApiFileHref(relPath: string): string {
  const encoded = encodePathSegments(relPath);
  return encoded ? `/api/file/${encoded}` : '/api/file';
}

export function vaultRootLabel(root: string): string {
  return VAULT_ROOTS[root]?.label ?? prettify(root);
}

export function vaultRootOverviewHref(root: string): string | undefined {
  return VAULT_ROOTS[root]?.overviewHref;
}

function vaultTailForDisplay(root: string, tail: string[]): string[] {
  if (root === 'logs' && tail[0] === 'daily') return tail.slice(1);
  return tail;
}

function vaultBreadcrumbs(parts: string[]): BreadcrumbSegment[] {
  if (parts.length === 0) return [];

  const root = parts[0];
  if (!root) return [];
  const tail = parts.slice(1);
  const rootMeta = VAULT_ROOTS[root];
  const crumbs: BreadcrumbSegment[] = [
    rootMeta ? { label: rootMeta.label, href: rootMeta.overviewHref } : { label: prettify(root) },
  ];

  for (const part of vaultTailForDisplay(root, tail)) {
    crumbs.push({ label: prettify(part) });
  }

  return crumbs;
}

export function appBreadcrumbs(pathname: string): BreadcrumbSegment[] {
  if (pathname === '/') return [{ label: 'today', href: '/' }];

  const parts = normalizePathValue(pathname).split('/').filter(Boolean);
  if (parts.length === 0) return [];

  const first = parts[0];
  if (!first) return [];

  if (first === 'p') return vaultBreadcrumbs(parts.slice(1));
  if (first === 'file') return vaultBreadcrumbs(parts.slice(1));
  if (VAULT_ROOTS[first]) return vaultBreadcrumbs(parts);

  const crumbs: BreadcrumbSegment[] = [];
  let href = '';
  for (const part of parts) {
    href += `/${part}`;
    crumbs.push({ label: prettify(part), href });
  }
  return crumbs;
}

export function isDailyRoute(pathname: string): boolean {
  return pathname === '/daily' || pathname.startsWith('/daily/') || pathname === '/logs' || pathname.startsWith('/logs/');
}

export function isOutputsRoute(pathname: string): boolean {
  return pathname === '/outputs' || pathname.startsWith('/outputs/') || pathname === '/out' || pathname.startsWith('/out/');
}

export function isVaultRoute(pathname: string): boolean {
  return (
    pathname === '/vault' ||
    pathname.startsWith('/vault/') ||
    pathname.startsWith('/brain/') ||
    pathname === '/inbox' ||
    pathname.startsWith('/inbox/') ||
    pathname.startsWith('/p/')
  );
}
