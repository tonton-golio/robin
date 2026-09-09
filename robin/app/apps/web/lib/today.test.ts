import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLatestBrief, getTodaySnapshot } from '@/lib/today';
import { loadOverview } from './overview';

let temporaryVault: string | null = null;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (!temporaryVault) return;
  await fs.rm(temporaryVault, { recursive: true, force: true });
  temporaryVault = null;
});

describe('Day workspace data', () => {
  it('returns the literal newest brief source with its modified time', async () => {
    temporaryVault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-day-'));
    const reports = path.join(temporaryVault, 'logs', 'reports');
    const remsleep = path.join(temporaryVault, 'logs', 'remsleep');
    await fs.mkdir(reports, { recursive: true });
    await fs.mkdir(remsleep, { recursive: true });

    const older = path.join(reports, 'morning-brief-2026-07-27.md');
    const newest = path.join(remsleep, '2026-07-28.html');
    await fs.writeFile(older, '- Older focus\n', 'utf8');
    await fs.writeFile(newest, '<ul><li>Protect the writing block.</li><li>Review the launch note.</li></ul>', 'utf8');

    const olderTime = new Date('2026-07-27T06:00:00.000Z');
    const newestTime = new Date('2026-07-28T06:30:00.000Z');
    await fs.utimes(older, olderTime, olderTime);
    await fs.utimes(newest, newestTime, newestTime);

    const brief = await loadLatestBrief(temporaryVault);

    expect(brief.source).toBe('logs/remsleep/2026-07-28.html');
    expect(brief.modifiedAt).toBe(newestTime.toISOString());
    expect(brief.bullets.map((item) => item.text)).toEqual([
      'Protect the writing block.',
      'Review the launch note.',
    ]);
  });

  it('uses the agent overview for Day actions, including paths and canonical priority order', async () => {
    temporaryVault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-day-shared-'));
    vi.stubEnv('ROBIN_VAULT', temporaryVault);
    await fs.mkdir(path.join(temporaryVault, 'brain/tasks'), { recursive: true });
    for (const [name, status, priority] of [
      ['priority', 'open', 'p0'], ['working', 'in-progress', 'p2'],
      ['backlog', 'in-progress', 'p3'], ['finished', 'done', 'p0'],
    ]) {
      await fs.writeFile(path.join(temporaryVault, `brain/tasks/${name}.html`), `<html><head><title>${name}</title>
        <meta name="robin:type" content="task"><meta name="robin:status" content="${status}">
        <meta name="robin:priority" content="${priority}"><meta name="robin:next_action" content="Check the result">
        </head><body><article data-robin-doc>Example</article></body></html>`);
    }
    const now = new Date('2027-04-01T12:00:00Z');
    const day = await getTodaySnapshot(now);
    expect(day.overview).toEqual(await loadOverview(temporaryVault, now));
    expect(day.overview.nextActions.map(item => item.path)).toEqual([
      'brain/tasks/priority.html', 'brain/tasks/working.html',
    ]);
    expect(day).not.toHaveProperty('topTasks');
  });
});
