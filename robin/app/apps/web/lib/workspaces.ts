import {
  Activity,
  CheckSquare,
  ClipboardCheck,
  Database,
  FileText,
  FolderTree,
  HeartPulse,
  Inbox,
  Search,
  Sunrise,
  UserSearch,
  type LucideIcon,
} from 'lucide-react';
import {
  isActivityRoute,
  isCandidatesRoute,
  isDayWorkspaceRoute,
  isHealthRoute,
  isInboxWorkspaceRoute,
  isLibraryWorkspaceRoute,
  isMemoryRoute,
  isPublishWorkspaceRoute,
  isReviewWorkspaceRoute,
  isSearchRoute,
  isTasksRoute,
} from './routes';

export const WORKSPACE_IDS = ['day', 'inbox', 'review', 'library', 'publish'] as const;

export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export interface CommandDestinationBase {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Second key in the global `g <key>` navigation chord. */
  chord: string;
  description: string;
  keywords: readonly string[];
  match: (pathname: string) => boolean;
}

export interface Workspace extends CommandDestinationBase {
  kind: 'workspace';
  id: WorkspaceId;
}

/** Compatibility name for consumers that distinguish primary destinations. */
export type PrimaryWorkspace = Workspace;

export type SecondaryDestinationId =
  | 'tasks'
  | 'changes'
  | 'memory'
  | 'hiring'
  | 'health'
  | 'search';

export interface SecondaryDestination extends CommandDestinationBase {
  kind: 'secondary';
  id: SecondaryDestinationId;
  /** Primary workspace that remains active while this destination is open. */
  workspace: WorkspaceId;
}

/** Compatibility name retained during the navigation migration. */
export type SecondaryCommandDestination = SecondaryDestination;

/**
 * The five primary Living Workspace destinations.
 *
 * Chords retain the old shell's muscle memory where a destination has a direct
 * successor: Today (`o`), Vault (`v`), and Outputs (`u`). Inbox and Review are
 * new primary destinations and therefore receive new `i` and `r` chords.
 */
export const WORKSPACES = [
  {
    kind: 'workspace',
    id: 'day',
    label: 'Day',
    href: '/',
    icon: Sunrise,
    chord: 'o',
    description: 'Brief, focus, schedule, tasks, and Robin receipts',
    keywords: ['today', 'home', 'brief', 'focus', 'schedule'],
    match: (pathname: string) => workspaceIdForPath(pathname) === 'day',
  },
  {
    kind: 'workspace',
    id: 'inbox',
    label: 'Inbox',
    href: '/inbox',
    icon: Inbox,
    chord: 'i',
    description: 'Raw captures and recovery',
    keywords: ['capture', 'meeting', 'interview', 'raw', 'recovery'],
    match: (pathname: string) => workspaceIdForPath(pathname) === 'inbox',
  },
  {
    kind: 'workspace',
    id: 'review',
    label: 'Review',
    href: '/review',
    icon: ClipboardCheck,
    chord: 'r',
    description: 'Judgments that need a human',
    keywords: ['decide', 'intervention', 'belief', 'comment', 'approval'],
    match: (pathname: string) => workspaceIdForPath(pathname) === 'review',
  },
  {
    kind: 'workspace',
    id: 'library',
    label: 'Library',
    href: '/library',
    icon: FolderTree,
    chord: 'v',
    description: 'Files, knowledge, and memory history',
    keywords: ['vault', 'brain', 'files', 'knowledge', 'browse'],
    match: (pathname: string) => workspaceIdForPath(pathname) === 'library',
  },
  {
    kind: 'workspace',
    id: 'publish',
    label: 'Publish',
    href: '/publish',
    icon: FileText,
    chord: 'u',
    description: 'Drafts, delivered artifacts, and sharing state',
    keywords: ['outputs', 'out', 'artifacts', 'reports', 'deliverables'],
    match: (pathname: string) => workspaceIdForPath(pathname) === 'publish',
  },
] as const satisfies readonly Workspace[];

/** Compatibility alias for the implementation-plan terminology. */
export const PRIMARY_WORKSPACES = WORKSPACES;

/**
 * Fully supported routes that move out of primary navigation.
 *
 * Their chords intentionally preserve the existing shell shortcuts so the IA
 * migration does not break keyboard habits.
 */
export const SECONDARY_DESTINATIONS = [
  {
    kind: 'secondary',
    id: 'tasks',
    label: 'Tasks',
    href: '/tasks',
    icon: CheckSquare,
    chord: 't',
    workspace: 'day',
    description: 'Task board, timeline, and calendar',
    keywords: ['todo', 'standup', 'board', 'calendar'],
    match: isTasksRoute,
  },
  {
    kind: 'secondary',
    id: 'changes',
    label: 'Changes',
    href: '/activity',
    icon: Activity,
    chord: 'a',
    workspace: 'day',
    description: 'Recent edits, comments, and sessions',
    keywords: ['activity', 'edits', 'history', 'ledger'],
    match: isActivityRoute,
  },
  {
    kind: 'secondary',
    id: 'memory',
    label: 'Memory history',
    href: '/memory',
    icon: Database,
    chord: 'm',
    workspace: 'library',
    description: 'Durable memory history',
    keywords: ['beliefs', 'events', 'recall', 'facts'],
    match: isMemoryRoute,
  },
  {
    kind: 'secondary',
    id: 'hiring',
    label: 'Hiring',
    href: '/candidates',
    icon: UserSearch,
    chord: 'p',
    workspace: 'day',
    description: 'Candidate pipeline',
    keywords: ['candidates', 'recruiting', 'interviews', 'people'],
    match: isCandidatesRoute,
  },
  {
    kind: 'secondary',
    id: 'health',
    label: 'System health',
    href: '/health',
    icon: HeartPulse,
    chord: 'h',
    workspace: 'day',
    description: 'Vault lint and system status',
    keywords: ['maintenance', 'diagnostics', 'status', 'fix'],
    match: isHealthRoute,
  },
  {
    kind: 'secondary',
    id: 'search',
    label: 'Full search results',
    href: '/search',
    icon: Search,
    chord: 's',
    workspace: 'library',
    description: 'Full-text search results',
    keywords: ['find', 'query', 'lookup', 'grep'],
    match: isSearchRoute,
  },
] as const satisfies readonly SecondaryDestination[];

/** Compatibility alias for the implementation-plan terminology. */
export const SECONDARY_COMMAND_DESTINATIONS = SECONDARY_DESTINATIONS;

export const COMMAND_DESTINATIONS = [
  ...WORKSPACES,
  ...SECONDARY_DESTINATIONS,
] as const;

/** One collision-free lookup for the shell and command palette. */
export const WORKSPACE_CHORD_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(COMMAND_DESTINATIONS.map((destination) => [destination.chord, destination.href])),
);

/** Compatibility alias for earlier route-contract consumers. */
export const COMMAND_CHORD_MAP = WORKSPACE_CHORD_MAP;

/**
 * First matching rule wins. Several legacy reader routes intentionally match a
 * generic Library rule as well as their storage owner:
 *
 * - `/inbox/*` and `/p/inbox/*` belong to Inbox, not generic Library.
 * - `/out/*`, `/file/out/*`, and `/p/out/*` belong to Publish.
 * - `/logs/*`, `/file/logs/*`, and `/p/logs/*` belong to Day.
 * - `/comments` is the legacy returned-comments entry and belongs to Review,
 *   even though the old Activity matcher also accepts it.
 */
export const WORKSPACE_ROUTE_PRECEDENCE = [
  'review',
  'inbox',
  'publish',
  'day',
  'library',
] as const satisfies readonly WorkspaceId[];

const WORKSPACE_MATCHERS: Record<WorkspaceId, (pathname: string) => boolean> = {
  day: isDayWorkspaceRoute,
  inbox: isInboxWorkspaceRoute,
  review: isReviewWorkspaceRoute,
  library: isLibraryWorkspaceRoute,
  publish: isPublishWorkspaceRoute,
};

function pathnameOnly(value: string): string {
  const raw = value.trim();
  if (!raw) return '/';

  let pathname = raw;
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      // Fall through to the conservative string normalization below.
    }
  }
  pathname = pathname.split(/[?#]/, 1)[0] || '/';
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/**
 * Resolve every application path to exactly one primary workspace.
 * Unknown/future secondary routes fall back to Day, Robin's safe home context.
 */
export function workspaceIdForPath(pathname: string): WorkspaceId {
  const normalized = pathnameOnly(pathname);
  for (const id of WORKSPACE_ROUTE_PRECEDENCE) {
    if (WORKSPACE_MATCHERS[id](normalized)) return id;
  }
  return 'day';
}

export function workspaceForPath(pathname: string): PrimaryWorkspace {
  const id = workspaceIdForPath(pathname);
  const workspace = WORKSPACES.find((candidate) => candidate.id === id);
  return workspace ?? WORKSPACES[0];
}

export function isWorkspaceActive(id: WorkspaceId, pathname: string): boolean {
  return workspaceIdForPath(pathname) === id;
}
