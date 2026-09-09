import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileMeetingSignals } from './meeting-compiler';
import { coerceMeetingSignals } from './meeting-signals';
import { listOpenInterventions, resolveIntervention } from './interventions';
import { ensureCommitmentCheckpointInterventions, loadFollowThrough } from './follow-through';

const vaults: string[] = [];

async function makeVault(): Promise<string> {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-follow-through-'));
  vaults.push(vault);
  await fs.mkdir(path.join(vault, 'brain'), { recursive: true });
  return vault;
}

afterEach(async () => {
  await Promise.all(vaults.splice(0).map(vault => fs.rm(vault, { recursive: true, force: true })));
});

function dateFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function compileCommitment(input: {
  vault: string;
  id?: string;
  due: string;
  evidenceState?: 'reported' | 'inferred';
}) {
  const id = input.id ?? 'follow-up';
  return compileMeetingSignals({
    vault: input.vault,
    meetingId: `meeting-${id}`,
    sourcePath: `inbox/meetings/${id}.md`,
    sourceRevision: `revision-${id}`,
    meetingPath: `logs/meetings/${id}.html`,
    meetingSlug: id,
    meetingTitle: 'Follow-through review',
    meetingDate: new Date().toISOString().slice(0, 10),
    sourceUpdated: new Date().toISOString(),
    signals: coerceMeetingSignals({
      commitments: [{
        id,
        text: 'Send Sam the revised plan',
        owner: 'Alex',
        due: input.due,
        evidenceState: input.evidenceState ?? 'reported',
      }],
    }),
  });
}

describe('follow-through projection', () => {
  it('projects one reviewed promise without claiming it is on track', async () => {
    const vault = await makeVault();
    await compileCommitment({ vault, due: dateFromNow(4) });

    const snapshot = await loadFollowThrough(vault);
    expect(snapshot.watching).toHaveLength(1);
    expect(snapshot.watching[0]).toMatchObject({
      statement: 'Send Sam the revised plan',
      owner: 'Alex',
      evidenceState: 'reported',
    });
    expect(snapshot.watching[0]!.reason).toContain('No exception is recorded');
    expect(snapshot.watching[0]!.reason.toLowerCase()).not.toContain('on track');
    expect(snapshot.changes.some(change => change.kind === 'commitment-created')).toBe(true);
    expect(snapshot.historyAvailable).toBe(true);
  });

  it('keeps authority separate from lifecycle and preserves confirmation on replay', async () => {
    const vault = await makeVault();
    const compiled = await compileCommitment({
      vault,
      id: 'tentative',
      due: dateFromNow(4),
      evidenceState: 'inferred',
    });
    expect((await loadFollowThrough(vault)).watching).toEqual([]);

    const confirmation = (await listOpenInterventions(vault))[0]!;
    expect(confirmation.kind).toBe('commitment-confirmation');
    await resolveIntervention(vault, confirmation.path, 'confirmed');

    const afterConfirmation = await loadFollowThrough(vault);
    expect(afterConfirmation.watching).toHaveLength(1);
    expect(afterConfirmation.watching[0]!.evidenceState).toBe('confirmed');
    expect(afterConfirmation.changes.some(change => change.kind === 'commitment-confirmed')).toBe(true);

    const replay = await compileCommitment({
      vault,
      id: 'tentative',
      due: dateFromNow(4),
      evidenceState: 'inferred',
    });
    expect(replay.commitments[0]).toMatchObject({ path: compiled.commitments[0]!.path, written: false });
    expect((await loadFollowThrough(vault)).watching[0]!.evidenceState).toBe('confirmed');
  });

  it('turns a passed checkpoint into a durable outcome judgment', async () => {
    const vault = await makeVault();
    await compileCommitment({ vault, id: 'overdue', due: '2000-01-01' });

    const created = await ensureCommitmentCheckpointInterventions(vault);
    expect(created).toHaveLength(1);
    expect(await ensureCommitmentCheckpointInterventions(vault)).toEqual([]);
    expect((await loadFollowThrough(vault)).watching).toEqual([]);

    const checkpoint = (await listOpenInterventions(vault))[0]!;
    expect(checkpoint).toMatchObject({
      kind: 'commitment-checkpoint',
      evidenceState: 'stale',
      targetTitle: 'Send Sam the revised plan',
    });
    const resolution = await resolveIntervention(vault, checkpoint.path, 'fulfilled');
    expect(resolution).toMatchObject({ targetUpdated: true, status: 'resolved' });
    expect(await listOpenInterventions(vault)).toEqual([]);
    expect(await ensureCommitmentCheckpointInterventions(vault)).toEqual([]);

    const after = await loadFollowThrough(vault);
    expect(after.watching).toEqual([]);
    expect(after.changes[0]).toMatchObject({ kind: 'fulfilled' });
    const commitment = await fs.readFile(path.join(vault, checkpoint.commitmentPath!), 'utf8');
    expect(commitment).toContain('name="robin:lifecycle" content="fulfilled"');
    expect(commitment).toContain('Kept as promised');
  });

  it('refuses a checkpoint outcome when the promise changed after Robin raised it', async () => {
    const vault = await makeVault();
    await compileCommitment({ vault, id: 'stale', due: '2000-01-01' });
    await ensureCommitmentCheckpointInterventions(vault);
    const checkpoint = (await listOpenInterventions(vault))[0]!;
    await fs.appendFile(path.join(vault, checkpoint.commitmentPath!), '\n<!-- corrected elsewhere -->\n', 'utf8');

    await expect(resolveIntervention(vault, checkpoint.path, 'fulfilled'))
      .rejects.toThrow('intervention_target_changed');
    expect(await listOpenInterventions(vault)).toHaveLength(1);
  });
});
