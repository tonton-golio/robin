import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('configurable owner identity', () => {
  it('uses neutral aliases when no owner is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_ROBIN_OWNER', '');
    const { isOwner, OWNER_LABEL } = await import('./owner-identity');
    expect(OWNER_LABEL).toBe('You');
    for (const value of ['Owner', ' human ', 'you']) expect(isOwner(value)).toBe(true);
    for (const value of ['', 'Alex', 'candidate']) expect(isOwner(value)).toBe(false);
  });

  it('matches configured names without substring or regex false positives', async () => {
    vi.stubEnv('NEXT_PUBLIC_ROBIN_OWNER', '  Åsa  ');
    const { isOwner, matchesName } = await import('./owner-identity');
    expect(isOwner('ÅSA Example')).toBe(true);
    expect(isOwner('Åsaström')).toBe(false);
    expect(matchesName('For A. Example', 'A. Example')).toBe(true);
    expect(matchesName('For Ax Example', 'A. Example')).toBe(false);
    expect(matchesName('Alexandra', 'Alex')).toBe(false);
    expect(matchesName('anything', '')).toBe(false);
  });

  it('uses the configured owner for the task mine filter and provenance', async () => {
    vi.stubEnv('NEXT_PUBLIC_ROBIN_OWNER', 'Alex');
    const { computeRollup, leafMatches, provenanceFor, DEFAULT_VIEW } = await import('../components/tasks/task-view');
    const rows = ['Alex', 'Alexandra', 'owner'].map((owner, i) => ({
      owner, title: `Example ${i}`, slug: `example-${i}`, path: `brain/tasks/example-${i}.html`,
      href: `/p/example-${i}`, tags: [], state: 'open', mtime: '2030-04-01T00:00:00Z',
    }));
    expect(computeRollup(rows).mine).toBe(2);
    expect(rows.filter(t => leafMatches(t, { ...DEFAULT_VIEW, rf: 'mine' }, () => null, false)).map(t => t.owner)).toEqual(['Alex', 'owner']);
    expect(provenanceFor(rows[0]!).who).toBe('human');
    expect(provenanceFor(rows[1]!).who).toBeUndefined();
  });

  it('keeps candidate summaries and legacy owner flags working with custom identity', async () => {
    vi.stubEnv('NEXT_PUBLIC_ROBIN_OWNER', 'Alex');
    const { summarise, ownerLabel, flagClass, flagLabel } = await import('../app/candidates/model');
    const owners = ['Alex', 'owner', 'candidate', 'closed', 'Alexandra'];
    const rows = owners.map(owner => ({ owner })) as Parameters<typeof summarise>[0];
    expect(summarise(rows)).toEqual({ total: 5, waitingOwner: 2, waitingCandidate: 1, active: 4, closed: 1 });
    expect(ownerLabel('Alex')).toBe('You');
    expect(ownerLabel('Alexandra')).toBe('Alexandra');
    expect(flagClass('blocked_on_alex')).toBe('cand-flag is-warn');
    expect(flagLabel('blocked_on_alex')).toBe('Waiting on you');
    expect(flagLabel('blocked_on_owner')).toBe('Waiting on you');
  });
});
