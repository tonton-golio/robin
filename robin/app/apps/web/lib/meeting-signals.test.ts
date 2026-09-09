import { describe, expect, it } from 'vitest';
import {
  coerceMeetingSignals,
  decodeMeetingSignals,
  encodeMeetingSignals,
  hasMeetingSignals,
} from './meeting-signals';

describe('meeting signals', () => {
  it('coerces legacy action items and qualitative evidence', () => {
    const result = coerceMeetingSignals({
      decisions: [{ text: 'Beacon launches August 1', evidenceState: 'reported' }],
      actionItems: [{ text: 'Send Sam the plan', owner: 'Alex', due: '2026-07-24', evidenceState: 'reported' }],
      conflicts: [{
        subject: 'Beacon budget',
        existingValue: '$100k',
        newValue: '$120k',
      }],
    });

    expect(result.decisions[0]).toMatchObject({
      text: 'Beacon launches August 1',
      evidenceState: 'reported',
    });
    expect(result.commitments[0]).toMatchObject({
      text: 'Send Sam the plan',
      owner: 'Alex',
      due: '2026-07-24',
      evidenceState: 'reported',
    });
    expect(result.conflicts[0]).toMatchObject({
      existingValue: '$100k',
      proposedValue: '$120k',
    });
  });

  it('drops malformed or empty entries instead of promoting them', () => {
    const result = coerceMeetingSignals({
      decisions: [{ text: '  ' }, null],
      commitments: [{ text: 'Ship', due: 'Friday' }],
      conflicts: [{ subject: 'Budget', existingValue: '$100k', proposedValue: '$100k' }],
    });

    expect(result.decisions).toEqual([]);
    expect(result.commitments[0]?.due).toBeNull();
    expect(result.conflicts).toEqual([]);
  });

  it('round-trips through a single safe frontmatter scalar', () => {
    const encoded = encodeMeetingSignals({
      decisions: [{ text: 'Use "Beacon" & ship', evidenceState: 'inferred' }],
      commitments: [],
      conflicts: [],
    });

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeMeetingSignals(encoded)).toEqual({
      schemaVersion: 1,
      meetingId: '',
      reviewedAt: '',
      decisions: [{
        id: expect.stringMatching(/^decision-/),
        text: 'Use "Beacon" & ship',
        evidenceState: 'inferred',
      }],
      commitments: [],
      conflicts: [],
    });
    expect(hasMeetingSignals(decodeMeetingSignals(encoded)!)).toBe(true);
    expect(decodeMeetingSignals('not-valid-json')).toBeNull();
  });

  it('rejects duplicate stable ids before two signals can share a durable path', () => {
    expect(() => coerceMeetingSignals({
      commitments: [
        { id: 'same-promise', text: 'First promise', evidenceState: 'reported' },
        { id: 'same-promise', text: 'Second promise', evidenceState: 'reported' },
      ],
    })).toThrow('duplicate_meeting_signal_id:commitment:same-promise');
  });
});
