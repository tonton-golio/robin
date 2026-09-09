import { describe, expect, it } from 'vitest';
import { isActivityRoute, isVaultRoute } from './routes';
import {
  COMMAND_DESTINATIONS,
  SECONDARY_DESTINATIONS,
  WORKSPACES,
  WORKSPACE_CHORD_MAP,
  WORKSPACE_ROUTE_PRECEDENCE,
  isWorkspaceActive,
  type WorkspaceId,
  workspaceForPath,
  workspaceIdForPath,
} from './workspaces';

describe('workspace registry', () => {
  it('defines the five selected primary workspaces in display order', () => {
    expect(
      WORKSPACES.map(({ id, label, href, chord }) => ({ id, label, href, chord })),
    ).toEqual([
      { id: 'day', label: 'Day', href: '/', chord: 'o' },
      { id: 'inbox', label: 'Inbox', href: '/inbox', chord: 'i' },
      { id: 'review', label: 'Review', href: '/review', chord: 'r' },
      { id: 'library', label: 'Library', href: '/library', chord: 'v' },
      { id: 'publish', label: 'Publish', href: '/publish', chord: 'u' },
    ]);

    for (const workspace of WORKSPACES) {
      expect(workspace.icon).toBeTypeOf('object');
      expect(workspace.description.length).toBeGreaterThan(0);
      expect(workspace.keywords.length).toBeGreaterThan(0);
      expect(workspace.match(workspace.href)).toBe(true);
    }
  });

  it('defines every secondary command destination from the migration contract', () => {
    expect(
      SECONDARY_DESTINATIONS.map(({ id, href, chord, workspace }) => ({
        id,
        href,
        chord,
        workspace,
      })),
    ).toEqual([
      { id: 'tasks', href: '/tasks', chord: 't', workspace: 'day' },
      { id: 'changes', href: '/activity', chord: 'a', workspace: 'day' },
      { id: 'memory', href: '/memory', chord: 'm', workspace: 'library' },
      { id: 'hiring', href: '/candidates', chord: 'p', workspace: 'day' },
      { id: 'health', href: '/health', chord: 'h', workspace: 'day' },
      { id: 'search', href: '/search', chord: 's', workspace: 'library' },
    ]);

    for (const destination of SECONDARY_DESTINATIONS) {
      expect(destination.icon).toBeTypeOf('object');
      expect(destination.description.length).toBeGreaterThan(0);
      expect(destination.keywords.length).toBeGreaterThan(0);
      expect(destination.match(destination.href)).toBe(true);
    }
  });

  it('keeps command ids, hrefs, and chords collision-free', () => {
    const ids = COMMAND_DESTINATIONS.map((destination) => destination.id);
    const hrefs = COMMAND_DESTINATIONS.map((destination) => destination.href);
    const chords = COMMAND_DESTINATIONS.map((destination) => destination.chord);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(chords).size).toBe(chords.length);
    expect(Object.keys(WORKSPACE_CHORD_MAP)).toHaveLength(COMMAND_DESTINATIONS.length);
  });
});

describe('workspace route precedence', () => {
  const cases: Array<[WorkspaceId, string[]]> = [
    [
      'day',
      [
        '/',
        '/tasks',
        '/tasks/blocked',
        '/standup',
        '/daily',
        '/logs/daily/2026-07-27',
        '/file/logs/ingest-log.md',
        '/p/logs/daily/2026-07-27',
        '/candidates',
        '/activity',
        '/edits',
        '/health',
        '/maintenance',
      ],
    ],
    [
      'inbox',
      [
        '/inbox',
        '/inbox/meetings/team-sync',
        '/capture',
        '/capture/recovery',
        '/file/inbox/meetings/team-sync.md',
        '/p/inbox/meetings/team-sync',
      ],
    ],
    ['review', ['/review', '/review/memories/mem_123', '/comments']],
    [
      'library',
      [
        '/library',
        '/vault',
        '/brain/projects/robin',
        '/memory',
        '/search',
        '/file/brain/projects/robin.html',
        '/p/brain/projects/robin',
      ],
    ],
    [
      'publish',
      [
        '/publish',
        '/outputs',
        '/out/presentations/demo',
        '/file/out/presentations/demo.pdf',
        '/p/out/presentations/demo',
      ],
    ],
  ];

  for (const [workspace, paths] of cases) {
    it(`maps canonical, legacy, and deep ${workspace} paths`, () => {
      for (const path of paths) expect(workspaceIdForPath(path), path).toBe(workspace);
    });
  }

  it('resolves legacy matcher overlaps in the declared order', () => {
    expect(WORKSPACE_ROUTE_PRECEDENCE).toEqual([
      'review',
      'inbox',
      'publish',
      'day',
      'library',
    ]);

    expect(isActivityRoute('/comments')).toBe(true);
    expect(workspaceIdForPath('/comments')).toBe('review');

    for (const path of ['/inbox/meetings/x', '/p/inbox/meetings/x']) {
      expect(isVaultRoute(path)).toBe(true);
      expect(workspaceIdForPath(path)).toBe('inbox');
    }
    for (const path of ['/p/out/reports/x', '/p/logs/daily/x']) {
      expect(isVaultRoute(path)).toBe(true);
    }
    expect(workspaceIdForPath('/p/out/reports/x')).toBe('publish');
    expect(workspaceIdForPath('/p/logs/daily/x')).toBe('day');
  });

  it('normalizes query strings, hashes, trailing slashes, and absolute URLs', () => {
    expect(workspaceIdForPath('/review/?source=memory#item')).toBe('review');
    expect(workspaceIdForPath('library/')).toBe('library');
    expect(workspaceIdForPath('http://127.0.0.1:8400/out/report?q=1')).toBe('publish');
  });

  it('gives every path exactly one active primary workspace', () => {
    const paths = cases.flatMap(([, values]) => values).concat(['/about', '/new', '/future-route']);
    for (const path of paths) {
      const active = WORKSPACES.filter((workspace) => workspace.match(path));
      const resolved = workspaceForPath(path);
      expect(active, path).toHaveLength(1);
      expect(active[0]).toEqual(resolved);
      expect(isWorkspaceActive(resolved.id, path)).toBe(true);
    }
  });
});
