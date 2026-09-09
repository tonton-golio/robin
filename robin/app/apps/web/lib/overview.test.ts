import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveOverview, loadOverview, selectThoughts, type OverviewPage } from './overview';

const temporaryVaults: string[] = [];
afterEach(async () => { await Promise.all(temporaryVaults.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });
function page(name: string, values: Record<string, string | string[]>): OverviewPage {
  return { path: name, title: name, meta: Object.fromEntries(Object.entries(values).map(([key, value]) => [`robin:${key}`, Array.isArray(value) ? value : [value]])) };
}

describe('derived current overview', () => {
  it('uses explicit canonical states, preserves checkpoints, and bounds the response', () => {
    const pages = [
      page('brain/tasks/outcome.html', { type: 'task', kind: 'outcome', status: 'in_progress', owner: 'Project lead', due: '2027-04-04', next_action: 'Review the experiment' }),
      ...['cancelled', 'dropped', 'superseded', 'done', 'archived', 'unknown'].map((status) => page(`brain/tasks/${status}.html`, { type: 'task', status })),
      ...Array.from({ length: 9 }, (_, i) => page(`brain/tasks/action-${i}.html`, { type: 'task', state: 'open', priority: `p${i % 4}`, next_action: 'Verify the result' })),
      page('brain/tasks/status-wins.html', { type: 'task', status: 'done', state: 'open' }),
      page('brain/interventions/choice.html', { type: 'intervention', status: 'open', 'recommended-action': 'Confirm the owner' }),
      page('brain/interventions/resolved.html', { type: 'intervention', status: 'resolved' }),
    ];
    const result = deriveOverview(pages, new Date('2027-04-01T00:00:00Z'));
    expect(result.outcomes[0]).toMatchObject({ owner: 'Project lead', checkpoint: '2027-04-04', nextAction: 'Review the experiment' });
    expect(result.totals).toEqual({ outcomes: 1, nextActions: 7, needsUser: 1 });
    expect(result.nextActions).toHaveLength(6);
    expect(result.needsUser[0]?.nextAction).toBe('Confirm the owner');
  });


  it('separates concrete actions from review triggers and backlog, keeping v0.3 evidence', () => {
    const result = deriveOverview([
      page('brain/tasks/old.html', { type: 'task', status: 'open', priority: 'p0', due: '2027-03-01', 'source-ref': 'logs/meetings/checkpoint.html' }),
      page('brain/tasks/blocked.html', { type: 'task', status: 'blocked', priority: 'p1', next_action: 'Obtain the missing result' }),
      page('brain/tasks/backlog.html', { type: 'task', status: 'open', priority: 'p3' }),
      page('brain/tasks/archive/old.html', { type: 'task', status: 'open', priority: 'p0' }),
      page('brain/person.html', { type: 'person', updated: '2027-04-01' }),
      page('brain/idea.html', { type: 'knowledge', tag: 'thought', updated: '2027-04-02' }),
    ], new Date('2027-04-02T00:00:00Z'));
    expect(result.taskHygiene).toEqual({ overdue: 1, missingNextAction: 2, blocked: 1, backlog: 1 });
    expect(result.nextActions).toEqual([]);
    expect(result.needsUser.find(p => p.path === 'brain/tasks/blocked.html')?.nextAction).toBe('Obtain the missing result');
    expect(result.needsUser).toHaveLength(2);
    expect(result.needsUser[0]).toMatchObject({ sources: ['logs/meetings/checkpoint.html'], reviewReasons: ['Recorded checkpoint has passed; verify current status', 'Next action needs clarification'] });
    expect(result.relevantChanges.map(p => p.path)).toEqual(['brain/person.html']);
  });

  it('keeps review-triggered tasks out of the action lane without changing their recorded state', () => {
    const result = deriveOverview([
      page('brain/tasks/ready.html', { type: 'task', status: 'open', priority: 'p1', next_action: 'Run the pilot', due: '2027-04-05' }),
      page('brain/tasks/overdue.html', { type: 'task', status: 'open', priority: 'p0', next_action: 'Check the result', due: '2027-03-01' }),
      page('brain/tasks/blocked.html', { type: 'task', status: 'blocked', priority: 'p0', next_action: 'Request access' }),
    ], new Date('2027-04-01T00:00:00Z'));
    expect(result.nextActions.map(item => item.path)).toEqual(['brain/tasks/ready.html']);
    expect(result.needsUser.map(item => item.path)).toEqual(['brain/tasks/overdue.html', 'brain/tasks/blocked.html']);
    expect(result.needsUser[0]).toMatchObject({ state: 'open', nextAction: 'Check the result' });
    expect(result.totals).toMatchObject({ nextActions: 1, needsUser: 2 });
  });

  it('never promotes edit or creation times into source coverage', () => {
    const result = deriveOverview([
      page('logs/meetings/retained.html', { type: 'meeting', date: '2027-03-20', created: '2027-04-01', updated: '2027-04-02', source: 'inbox/archived/transcript.md' }),
      page('logs/reports/undated.html', { type: 'report', created: '2027-04-03', updated: '2027-04-03' }),
    ]);
    expect(result.sourceCoverage).toMatchObject({ records: 2, datedRecords: 1, latestRecordDate: '2027-03-20', externalCoverage: 'unknown' });
    expect(result.relevantChanges[0]).toMatchObject({ pageUpdatedAt: '2027-04-03' });
    expect(result.relevantChanges[0]?.sourceDate).toBeUndefined();
    expect(result.sourceCoverage.latest[0]?.sources).toEqual(['inbox/archived/transcript.md']);
  });

  it('matches the exact thought contract and keeps attribution visible', () => {
    const proposed = page('brain/thought.html', { type: 'knowledge', tag: ['idea', 'thought'], state: 'needs-review', author: 'A colleague', review_trigger: 'After the pilot' });
    expect(selectThoughts([
      proposed,
      page('brain/accepted.html', { type: 'knowledge', tag: 'thought', status: 'stable' }),
      page('brain/thinking/archives/old.html', { type: 'knowledge', tag: 'thought', status: 'needs-review' }),
      page('brain/untagged.html', { type: 'knowledge', status: 'needs-review' }),
      page('brain/task.html', { type: 'task', tag: 'thought', status: 'needs-review' }),
    ])).toMatchObject([{ path: proposed.path, author: 'A colleague', reviewTrigger: 'After the pilot' }]);
  });

  it('reads canonical head metadata without writing files, traversing links, or including archives', async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-overview-'));
    temporaryVaults.push(vault);
    await fs.mkdir(path.join(vault, 'brain/tasks/archive'), { recursive: true });
    const html = '<html><head><title>Example</title><meta name="robin:type" content="task"><meta name="robin:status" content="open"><meta name="robin:next_action" content="Check evidence"></head><body><meta name="robin:status" content="done"></body></html>';
    await fs.writeFile(path.join(vault, 'brain/tasks/active.html'), html);
    await fs.writeFile(path.join(vault, 'brain/tasks/archive/old.html'), html);
    await fs.symlink(path.join(vault, 'brain/tasks/active.html'), path.join(vault, 'brain/tasks/link.html'));
    const before = await fs.readdir(vault, { recursive: true });
    const now = new Date('2027-04-01T00:00:00Z');
    const [first, second] = await Promise.all([loadOverview(vault, now), loadOverview(vault, now)]);
    expect(first).toEqual(second);
    expect(first.totals.nextActions).toBe(1);
    expect(first.nextActions[0]?.state).toBe('open');
    expect(first.sourceCoverage.latestRecordDate).toBeUndefined();
    expect(await fs.readdir(vault, { recursive: true })).toEqual(before);
    expect(await fs.readFile(path.join(vault, 'brain/tasks/active.html'), 'utf8')).toBe(html);
  });
});
