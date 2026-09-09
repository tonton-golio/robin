import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../fixtures/robin-test';

const meetingId = 'cap-beacon-launch-20260720';
const dateFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const watchedDue = dateFromNow(4);
const passedDue = dateFromNow(-1);
const capture = {
  meetingId,
  slug: 'beacon-launch-alignment',
  title: 'Beacon launch alignment',
  summary: 'Beacon has a launch date and owner; the budget conflicts with Robin’s current record.',
  attendees: 'Alex, Sam',
  durationSec: 1800,
  transcript: `## Summary

Beacon launches August 1. Alex will send Sam the revised plan. The meeting corrected the budget.

## Decisions

- Beacon launches August 1

## Action items

- [ ] Send Sam the revised plan — Alex — due ${watchedDue}
- [ ] Close the launch briefing follow-up — Alex — due ${passedDue}

## Open questions

- Which budget should Robin use for Beacon?

## Transcript

**Sam:** Beacon launches August 1. Alex, send me the revised plan by ${watchedDue}. The launch briefing follow-up was due ${passedDue}. The budget is $120k, not $100k.`,
  signals: {
    decisions: [{ id: 'launch-date', text: 'Beacon launches August 1', evidenceState: 'reported' }],
    commitments: [{
      id: 'revised-plan',
      text: 'Send Sam the revised plan',
      owner: 'Alex',
      due: watchedDue,
      evidenceState: 'reported',
    }, {
      id: 'briefing-follow-up',
      text: 'Close the launch briefing follow-up',
      owner: 'Alex',
      due: passedDue,
      evidenceState: 'reported',
    }],
    conflicts: [{
      id: 'budget',
      subject: 'Beacon budget',
      existingValue: '$100k',
      proposedValue: '$120k',
      question: 'Which budget should Robin use for Beacon?',
    }],
  },
};

function matchingFiles(root: string, fragment: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(name => name.includes(fragment));
}

test('capture → compile → reconcile → intervene survives a hard restart', async ({
  page,
  request,
  robinServer,
}) => {
  const saveURL = `${robinServer.baseURL}/api/meeting/save-transcript`;
  const firstSave = await request.post(saveURL, { data: capture });
  expect(firstSave.ok()).toBe(true);
  const saved = await firstSave.json() as {
    path: string;
    ingestUrl: string;
    deduplicated: boolean;
  };
  expect(saved.deduplicated).toBe(false);

  const replaySave = await request.post(saveURL, { data: capture });
  expect(replaySave.ok()).toBe(true);
  expect(await replaySave.json()).toMatchObject({ path: saved.path, deduplicated: true });
  const sources = fs.readdirSync(path.join(robinServer.vaultPath, 'inbox', 'meetings'))
    .filter(name => fs.readFileSync(path.join(robinServer.vaultPath, 'inbox', 'meetings', name), 'utf8').includes(`meeting_id: ${meetingId}`));
  expect(sources).toHaveLength(1);

  const ingestURL = `${robinServer.baseURL}${saved.ingestUrl}`;
  const firstIngest = await request.post(ingestURL);
  expect(firstIngest.ok()).toBe(true);
  const compiled = await firstIngest.json() as {
    outputPath: string;
    compiled: {
      decisions: Array<{ path: string; written: boolean }>;
      commitments: Array<{ path: string; written: boolean }>;
      interventions: Array<{ path: string; written: boolean }>;
      receipt: { path: string; written: boolean };
    };
  };
  expect(compiled.compiled.decisions).toHaveLength(1);
  expect(compiled.compiled.commitments).toHaveLength(2);
  expect(compiled.compiled.interventions).toHaveLength(1);
  expect(compiled.compiled.receipt.written).toBe(true);

  const replayIngest = await request.post(ingestURL);
  expect(replayIngest.ok()).toBe(true);
  const replayCompiled = (await replayIngest.json()) as typeof compiled;
  expect([
    ...replayCompiled.compiled.decisions,
    ...replayCompiled.compiled.commitments,
    ...replayCompiled.compiled.interventions,
    replayCompiled.compiled.receipt,
  ].every(item => !item.written)).toBe(true);

  const beaconPath = path.join(robinServer.vaultPath, 'brain', 'projects', 'beacon.html');
  expect(fs.readFileSync(beaconPath, 'utf8')).toContain('$100k');
  expect(matchingFiles(path.join(robinServer.vaultPath, 'brain', 'decisions'), 'launch-date')).toHaveLength(1);
  expect(matchingFiles(path.join(robinServer.vaultPath, 'brain', 'commitments'), 'revised-plan')).toHaveLength(1);
  expect(matchingFiles(path.join(robinServer.vaultPath, 'brain', 'interventions'), 'budget')).toHaveLength(1);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await expect(page.getByText('Which budget should Robin use for Beacon?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use $120k' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Waiting' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Send Sam the revised plan', exact: true })).toBeVisible();
  await expect(page.getByText('What happened with: Close the launch briefing follow-up?')).toBeVisible();
  await expect(page.getByRole('link', { name: /beacon launch alignment/i })).toHaveCount(0);
  await expect(page.getByText(/beacon-launch-alignment/i)).toHaveCount(0);

  // Destroy the derived index and the actual process. Canonical pages and the
  // compile receipt must be sufficient to reconstruct the exact open judgment.
  await robinServer.restart({ dropIndex: true });
  await page.goto('/');
  await expect(page.getByText('Which budget should Robin use for Beacon?')).toBeVisible();
  expect(fs.readFileSync(beaconPath, 'utf8')).toContain('$100k');

  const afterRestartIngest = await request.post(ingestURL);
  expect(afterRestartIngest.ok()).toBe(true);
  const afterRestart = (await afterRestartIngest.json()) as typeof compiled;
  expect([
    ...afterRestart.compiled.decisions,
    ...afterRestart.compiled.commitments,
    ...afterRestart.compiled.interventions,
    afterRestart.compiled.receipt,
  ].every(item => !item.written)).toBe(true);

  await page.getByRole('link', { name: 'Decision review', exact: true }).click();
  await expect(page.getByText('Decision · Conflicting evidence')).toBeVisible();
  await page.getByRole('button', { name: 'Use $120k' }).click();
  await expect(page.getByRole('heading', { name: 'Which budget should Robin use for Beacon?' })).toHaveCount(0);
  expect(fs.readFileSync(beaconPath, 'utf8')).toContain('$120k');

  await page.getByRole('button', { name: 'Kept' }).click();
  await expect(page.getByRole('heading', { name: 'Review is clear' })).toBeVisible();
  const fulfilledCommitment = matchingFiles(
    path.join(robinServer.vaultPath, 'brain', 'commitments'),
    'briefing-follow-up',
  );
  expect(fulfilledCommitment).toHaveLength(1);
  expect(fs.readFileSync(path.join(
    robinServer.vaultPath,
    'brain',
    'commitments',
    fulfilledCommitment[0]!,
  ), 'utf8')).toContain('name="robin:lifecycle" content="fulfilled"');

  const resolutionDecision = matchingFiles(
    path.join(robinServer.vaultPath, 'brain', 'decisions'),
    'budget-resolution',
  );
  expect(resolutionDecision).toHaveLength(1);
  const historyRoot = path.join(robinServer.vaultPath, '.history', 'brain', 'projects', 'beacon.html');
  expect(fs.existsSync(historyRoot)).toBe(true);

  const interventionPath = compiled.compiled.interventions[0]!.path;
  const resolutionReplay = await request.post(`${robinServer.baseURL}/api/intervention/resolve`, {
    data: { path: interventionPath, resolution: 'proposed' },
  });
  expect(resolutionReplay.ok()).toBe(true);
  expect(await resolutionReplay.json()).toMatchObject({ alreadyResolved: true, targetUpdated: false });

  await robinServer.restart({ dropIndex: true });
  await page.goto('/');
  await expect(page.getByText('Which budget should Robin use for Beacon?')).toHaveCount(0);
  await expect(page.getByText('What happened with: Close the launch briefing follow-up?')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Waiting' })).toBeVisible();
  const overviewResponse = await request.get(`${robinServer.baseURL}/api/overview`);
  expect(overviewResponse.ok()).toBe(true);
  const overview = await overviewResponse.json();
  expect(overview.followThrough.changes.some((change: { summary: string }) => change.summary === 'Beacon budget is now $120k.')).toBe(true);
  expect(overview.followThrough.changes.some((change: { summary: string }) => /Close the launch briefing follow-up was kept/.test(change.summary))).toBe(true);
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Review is clear' })).toBeVisible();
  await page.goto('/');
  expect(fs.readFileSync(beaconPath, 'utf8')).toContain('$120k');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Waiting' })).toBeVisible();
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
});
