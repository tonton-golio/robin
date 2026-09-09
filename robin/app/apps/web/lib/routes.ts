const VAULT_ROOT_LABELS: Record<string, string> = {
  brain: 'brain',
  inbox: 'vault',
  logs: 'daily',
  out: 'outputs',
};

function normalizePathValue(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
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
  return VAULT_ROOT_LABELS[root] ?? root.replace(/[-_]+/g, ' ');
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

/** Tasks home + the legacy standup board alias. */
export function isTasksRoute(pathname: string): boolean {
  return (
    pathname === '/tasks' ||
    pathname.startsWith('/tasks/') ||
    pathname === '/standup' ||
    pathname.startsWith('/standup/')
  );
}

/** Hiring pipeline tracker. */
export function isCandidatesRoute(pathname: string): boolean {
  return pathname === '/candidates' || pathname.startsWith('/candidates/');
}

export function isMemoryRoute(pathname: string): boolean {
  return pathname === '/memory' || pathname.startsWith('/memory/');
}

export function isSearchRoute(pathname: string): boolean {
  return pathname === '/search' || pathname.startsWith('/search/');
}

/** Live capture (meeting + interview) surface. */
export function isCaptureRoute(pathname: string): boolean {
  return pathname === '/capture' || pathname.startsWith('/capture/');
}

/** Activity feed — folds in the legacy edits + comments routes. */
export function isActivityRoute(pathname: string): boolean {
  return (
    pathname === '/activity' ||
    pathname.startsWith('/activity/') ||
    pathname === '/edits' ||
    pathname.startsWith('/edits/') ||
    pathname === '/comments' ||
    pathname.startsWith('/comments/')
  );
}

/** System health — folds in the legacy maintenance route. */
export function isHealthRoute(pathname: string): boolean {
  return (
    pathname === '/health' ||
    pathname.startsWith('/health/') ||
    pathname === '/maintenance' ||
    pathname.startsWith('/maintenance/')
  );
}

/**
 * Living Workspace route predicates.
 *
 * Some compatibility reader paths match more than one workspace predicate;
 * `lib/workspaces.ts` owns the documented first-match precedence that resolves
 * those overlaps.
 */
export function isReviewWorkspaceRoute(pathname: string): boolean {
  return (
    pathname === '/review' ||
    pathname.startsWith('/review/') ||
    pathname === '/comments' ||
    pathname.startsWith('/comments/')
  );
}

export function isInboxWorkspaceRoute(pathname: string): boolean {
  return (
    pathname === '/inbox' ||
    pathname.startsWith('/inbox/') ||
    isCaptureRoute(pathname) ||
    pathname === '/file/inbox' ||
    pathname.startsWith('/file/inbox/') ||
    pathname === '/p/inbox' ||
    pathname.startsWith('/p/inbox/')
  );
}

export function isPublishWorkspaceRoute(pathname: string): boolean {
  return (
    pathname === '/publish' ||
    pathname.startsWith('/publish/') ||
    isOutputsRoute(pathname) ||
    pathname === '/file/out' ||
    pathname.startsWith('/file/out/') ||
    pathname === '/p/out' ||
    pathname.startsWith('/p/out/')
  );
}

export function isDayWorkspaceRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    isTasksRoute(pathname) ||
    isCandidatesRoute(pathname) ||
    isDailyRoute(pathname) ||
    isActivityRoute(pathname) ||
    isHealthRoute(pathname) ||
    pathname === '/file/logs' ||
    pathname.startsWith('/file/logs/') ||
    pathname === '/p/logs' ||
    pathname.startsWith('/p/logs/') ||
    pathname === '/about' ||
    pathname.startsWith('/about/') ||
    pathname === '/new' ||
    pathname.startsWith('/new/')
  );
}

export function isLibraryWorkspaceRoute(pathname: string): boolean {
  return (
    pathname === '/library' ||
    pathname.startsWith('/library/') ||
    isVaultRoute(pathname) ||
    isMemoryRoute(pathname) ||
    isSearchRoute(pathname) ||
    pathname === '/brain' ||
    pathname === '/file' ||
    pathname.startsWith('/file/')
  );
}
