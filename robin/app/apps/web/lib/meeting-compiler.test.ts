import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileMeetingSignals } from './meeting-compiler';
import { listOpenInterventions, resolveIntervention } from './interventions';
import { coerceMeetingSignals } from './meeting-signals';

const tempVaults: string[] = [];

async function makeVault(): Promise<string> {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-meeting-compiler-'));
  tempVaults.push(vault);
  await fs.mkdir(path.join(vault, 'brain', 'projects'), { recursive: true });
  await fs.writeFile(path.join(vault, 'brain', 'projects', 'beacon.html'), `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>Beacon</title>
  <meta name="robin:path" content="brain/projects/beacon.html">
  <meta name="robin:slug" content="beacon">
  <meta name="robin:type" content="project">
  <meta name="robin:updated" content="2026-07-19T00:00:00Z">
</head><body><article data-robin-doc>
  <h1 data-block="heading">Beacon</h1>
  <p data-block="paragraph">Approved budget: $100k.</p>
</article></body></html>`, 'utf8');
  return vault;
}

afterEach(async () => {
  await Promise.all(tempVaults.splice(0).map(vault => fs.rm(vault, { recursive: true, force: true })));
});

describe('meeting compiler loop', () => {
  it('persists idempotent records, surfaces one conflict, and applies an explicit resolution with history', async () => {
    const vault = await makeVault();
    const input = {
      vault,
      meetingId: 'cap-beacon-launch-20260720',
      sourcePath: 'inbox/meetings/2026-07-20-beacon-alignment.md',
      sourceRevision: 'fixture-source-revision',
      meetingPath: 'logs/meetings/2026-07-20-beacon-alignment.html',
      meetingSlug: '2026-07-20-beacon-alignment',
      meetingTitle: 'Beacon alignment',
      meetingDate: '2026-07-20',
      sourceUpdated: '2026-07-20T09:00:00.000Z',
      signals: coerceMeetingSignals({
        decisions: [{ text: 'Beacon launches August 1', evidenceState: 'reported' }],
        commitments: [{
          text: 'Send Sam the revised plan',
          owner: 'Alex',
          due: '2026-07-24',
          evidenceState: 'reported',
        }],
        conflicts: [{
          subject: 'Beacon budget',
          existingValue: '$100k',
          proposedValue: '$120k',
          question: 'Which budget should Robin use for Beacon?',
        }],
      }),
    };

    const first = await compileMeetingSignals(input);
    expect(first.decisions).toHaveLength(1);
    expect(first.commitments).toHaveLength(1);
    expect(first.interventions).toHaveLength(1);
    expect(first.receipt.written).toBe(true);
    expect(first.decisions[0]?.written).toBe(true);

    const second = await compileMeetingSignals(input);
    expect(second.decisions[0]?.path).toBe(first.decisions[0]?.path);
    expect(second.decisions[0]?.written).toBe(false);
    expect(second.commitments[0]?.written).toBe(false);
    expect(second.interventions[0]?.written).toBe(false);
    expect(second.receipt.written).toBe(false);

    // Compiler output is a promoted durable record, not a cache. A later replay
    // must not erase a correction made after the meeting was compiled.
    const commitmentPath = path.join(vault, first.commitments[0]!.path);
    const corrected = (await fs.readFile(commitmentPath, 'utf8'))
      .replace('name="robin:owner" content="Alex"', 'name="robin:owner" content="Sam"');
    await fs.writeFile(commitmentPath, corrected, 'utf8');
    const afterCorrection = await compileMeetingSignals(input);
    expect(afterCorrection.commitments[0]?.written).toBe(false);
    expect(await fs.readFile(commitmentPath, 'utf8')).toContain('name="robin:owner" content="Sam"');

    const open = await listOpenInterventions(vault);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      kind: 'conflict',
      existingValue: '$100k',
      proposedValue: '$120k',
      targetTitle: 'Beacon',
    });

    const resolved = await resolveIntervention(vault, open[0]!.path, 'proposed');
    expect(resolved).toMatchObject({
      status: 'resolved',
      targetUpdated: true,
      targetPath: 'brain/projects/beacon.html',
    });
    expect(await fs.readFile(path.join(vault, 'brain', 'projects', 'beacon.html'), 'utf8'))
      .toContain('$120k');
    expect(await listOpenInterventions(vault)).toEqual([]);

    const retried = await resolveIntervention(vault, open[0]!.path, 'proposed');
    expect(retried.alreadyResolved).toBe(true);
    expect(retried.targetUpdated).toBe(false);

    // A later compile (including after a process restart) must not reopen a
    // judgment that already reached a durable terminal state.
    const afterResolution = await compileMeetingSignals(input);
    expect(afterResolution.interventions[0]?.written).toBe(false);
    expect(await listOpenInterventions(vault)).toEqual([]);

    const editStreams = await fs.readdir(path.join(vault, 'inbox', 'robin', 'edits'));
    expect(editStreams.some(name => name.endsWith('.jsonl'))).toBe(true);
  });

  it('uses signal ids so reordering produces no writes', async () => {
    const vault = await makeVault();
    const base = {
      vault,
      meetingId: 'meeting-reorder',
      sourcePath: 'inbox/meetings/reorder.md',
      sourceRevision: 'same-source-revision',
      meetingPath: 'logs/meetings/reorder.html',
      meetingSlug: 'reorder',
      meetingTitle: 'Reorder test',
      meetingDate: '2026-07-20',
      sourceUpdated: '2026-07-20T09:00:00.000Z',
    };
    const signals = coerceMeetingSignals({
      meetingId: base.meetingId,
      reviewedAt: base.sourceUpdated,
      decisions: [
        { id: 'launch', text: 'Launch August 1', evidenceState: 'reported' },
        { id: 'scope', text: 'Keep the pilot private', evidenceState: 'reported' },
      ],
    });
    const first = await compileMeetingSignals({ ...base, signals });
    const reordered = await compileMeetingSignals({
      ...base,
      signals: { ...signals, decisions: [...signals.decisions].reverse() },
    });

    expect(reordered.decisions.map(item => item.path).sort())
      .toEqual(first.decisions.map(item => item.path).sort());
    expect(reordered.decisions.every(item => !item.written)).toBe(true);
    expect(reordered.receipt.written).toBe(false);
  });

  it('refuses to overwrite a human-owned page at a generated path', async () => {
    const vault = await makeVault();
    const collisionPath = path.join(vault, 'brain', 'decisions', 'collision-decision-human-id.html');
    await fs.mkdir(path.dirname(collisionPath), { recursive: true });
    await fs.writeFile(collisionPath, '<html><head><title>Human page</title></head><body>keep me</body></html>', 'utf8');
    const signals = coerceMeetingSignals({
      decisions: [{ id: 'human-id', text: 'Do not overwrite', evidenceState: 'reported' }],
    });

    await expect(compileMeetingSignals({
      vault,
      meetingId: 'collision-meeting',
      sourcePath: 'inbox/meetings/collision.md',
      sourceRevision: 'collision-revision',
      meetingPath: 'logs/meetings/collision.html',
      meetingSlug: 'collision',
      meetingTitle: 'Collision',
      meetingDate: '2026-07-20',
      sourceUpdated: '2026-07-20T09:00:00.000Z',
      signals,
    })).rejects.toThrow(/meeting_compiler_path_collision/);
    expect(await fs.readFile(collisionPath, 'utf8')).toContain('keep me');
  });

  it('rejects an approved replacement when the target changed after reconciliation', async () => {
    const vault = await makeVault();
    const signals = coerceMeetingSignals({
      conflicts: [{
        id: 'budget',
        subject: 'Beacon budget',
        existingValue: '$100k',
        proposedValue: '$120k',
        question: 'Which budget should Robin use?',
      }],
    });
    const compiled = await compileMeetingSignals({
      vault,
      meetingId: 'stale-target',
      sourcePath: 'inbox/meetings/stale.md',
      sourceRevision: 'stale-revision',
      meetingPath: 'logs/meetings/stale.html',
      meetingSlug: 'stale',
      meetingTitle: 'Stale target',
      meetingDate: '2026-07-20',
      sourceUpdated: '2026-07-20T09:00:00.000Z',
      signals,
    });
    const beaconPath = path.join(vault, 'brain', 'projects', 'beacon.html');
    await fs.appendFile(beaconPath, '\n<!-- changed elsewhere -->\n', 'utf8');

    await expect(resolveIntervention(vault, compiled.interventions[0]!.path, 'proposed'))
      .rejects.toThrow('intervention_target_changed');
    expect(await fs.readFile(beaconPath, 'utf8')).toContain('$100k');
    expect(await listOpenInterventions(vault)).toHaveLength(1);
  });
});
