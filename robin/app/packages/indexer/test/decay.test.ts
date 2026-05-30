/**
 * Pure function tests for the decay module.
 */

import { describe, it, expect } from 'vitest';
import { assignTier, computeRecency, computeStaleness, computeFinalScore } from '../src/decay.js';

const DAY_MS = 1000 * 60 * 60 * 24;
const NOW = Date.now();

describe('assignTier', () => {
  it('maps task → working', () => {
    expect(assignTier('task')).toBe('working');
  });

  it('maps meeting → episodic', () => {
    expect(assignTier('meeting')).toBe('episodic');
  });

  it('maps interview → episodic', () => {
    expect(assignTier('interview')).toBe('episodic');
  });

  it('maps brief → episodic', () => {
    expect(assignTier('brief')).toBe('episodic');
  });

  it('maps remsleep → episodic', () => {
    expect(assignTier('remsleep')).toBe('episodic');
  });

  it('maps person → semantic', () => {
    expect(assignTier('person')).toBe('semantic');
  });

  it('maps project → semantic', () => {
    expect(assignTier('project')).toBe('semantic');
  });

  it('maps knowledge → semantic', () => {
    expect(assignTier('knowledge')).toBe('semantic');
  });

  it('maps understanding → semantic', () => {
    expect(assignTier('understanding')).toBe('semantic');
  });

  it('maps decision → semantic', () => {
    expect(assignTier('decision')).toBe('semantic');
  });

  it('maps template → procedural', () => {
    expect(assignTier('template')).toBe('procedural');
  });

  it('maps skill → procedural', () => {
    expect(assignTier('skill')).toBe('procedural');
  });

  it('maps playbook → procedural', () => {
    expect(assignTier('playbook')).toBe('procedural');
  });

  it('defaults unknown type → semantic', () => {
    expect(assignTier('whatever')).toBe('semantic');
  });

  it('honors explicit robin:tier override', () => {
    expect(assignTier('task', 'procedural')).toBe('procedural');
    expect(assignTier('template', 'working')).toBe('working');
  });

  it('ignores invalid override', () => {
    expect(assignTier('task', 'bogus')).toBe('working');
    expect(assignTier('task', null)).toBe('working');
  });
});

describe('computeRecency', () => {
  it('procedural tier always returns 1', () => {
    const old = new Date(NOW - 1000 * DAY_MS).toISOString();
    expect(computeRecency('procedural', old, old, NOW)).toBe(1);
    expect(computeRecency('procedural', null, null, NOW)).toBe(1);
  });

  it('working tier: page updated today is near 1', () => {
    const updated = new Date(NOW).toISOString();
    const recency = computeRecency('working', null, updated, NOW);
    expect(recency).toBeCloseTo(1, 2);
  });

  it('working tier: page updated 30 days ago is ~0.368 (1/e)', () => {
    const updated = new Date(NOW - 30 * DAY_MS).toISOString();
    const recency = computeRecency('working', null, updated, NOW);
    // exp(-30/30) = exp(-1) ≈ 0.3679
    expect(recency).toBeCloseTo(Math.exp(-1), 3);
  });

  it('working tier: page updated 90 days ago is ~0.05', () => {
    const updated = new Date(NOW - 90 * DAY_MS).toISOString();
    const recency = computeRecency('working', null, updated, NOW);
    // exp(-90/30) = exp(-3) ≈ 0.0498
    expect(recency).toBeCloseTo(Math.exp(-3), 3);
  });

  it('semantic tier: page updated 365 days ago is ~0.368', () => {
    const updated = new Date(NOW - 365 * DAY_MS).toISOString();
    const recency = computeRecency('semantic', null, updated, NOW);
    expect(recency).toBeCloseTo(Math.exp(-1), 3);
  });

  it('episodic tier: page updated 90 days ago is ~0.368', () => {
    const updated = new Date(NOW - 90 * DAY_MS).toISOString();
    const recency = computeRecency('episodic', null, updated, NOW);
    expect(recency).toBeCloseTo(Math.exp(-1), 3);
  });

  it('prefers lastAccessed over updated', () => {
    const updated = new Date(NOW - 90 * DAY_MS).toISOString();
    const lastAccessed = new Date(NOW - 1 * DAY_MS).toISOString();
    const recency = computeRecency('working', lastAccessed, updated, NOW);
    // Should use lastAccessed (1 day ago), not updated (90 days ago)
    expect(recency).toBeCloseTo(Math.exp(-1 / 30), 3);
  });

  it('returns 1 when no date info', () => {
    expect(computeRecency('working', null, null, NOW)).toBe(1);
  });
});

describe('computeStaleness', () => {
  it('procedural tier is always 0 staleness', () => {
    const old = new Date(NOW - 1000 * DAY_MS).toISOString();
    expect(computeStaleness('procedural', old, old, NOW)).toBe(0);
  });

  it('fresh page has low staleness', () => {
    const updated = new Date(NOW).toISOString();
    const s = computeStaleness('working', null, updated, NOW);
    // staleness = 1 - (0.4 + 0.6*1) = 0
    expect(s).toBeCloseTo(0, 3);
  });

  it('very old working-tier page has high staleness', () => {
    const updated = new Date(NOW - 365 * DAY_MS).toISOString();
    const s = computeStaleness('working', null, updated, NOW);
    // exp(-365/30) ≈ 0, staleness = 1 - 0.4 = 0.6
    expect(s).toBeCloseTo(0.6, 1);
  });

  it('staleness formula: 1 - (0.4 + 0.6 * recency)', () => {
    const updated = new Date(NOW - 30 * DAY_MS).toISOString();
    const recency = Math.exp(-1); // working τ=30, Δt=30d
    const expected = 1 - (0.4 + 0.6 * recency);
    const actual = computeStaleness('working', null, updated, NOW);
    expect(actual).toBeCloseTo(expected, 5);
  });
});

describe('computeFinalScore', () => {
  it('access_boost increases score', () => {
    const updated = new Date(NOW).toISOString();
    const s0 = computeFinalScore(0.5, 'semantic', 0, null, updated, NOW);
    const s10 = computeFinalScore(0.5, 'semantic', 10, null, updated, NOW);
    expect(s10).toBeGreaterThan(s0);
  });

  it('older page scores lower than fresh page with same rrf', () => {
    const fresh = new Date(NOW).toISOString();
    const old = new Date(NOW - 90 * DAY_MS).toISOString();
    const sFresh = computeFinalScore(0.5, 'working', 0, null, fresh, NOW);
    const sOld = computeFinalScore(0.5, 'working', 0, null, old, NOW);
    expect(sFresh).toBeGreaterThan(sOld);
  });

  it('procedural page scores same regardless of age', () => {
    const old = new Date(NOW - 1000 * DAY_MS).toISOString();
    const fresh = new Date(NOW).toISOString();
    const sOld = computeFinalScore(0.5, 'procedural', 0, null, old, NOW);
    const sFresh = computeFinalScore(0.5, 'procedural', 0, null, fresh, NOW);
    expect(sOld).toBeCloseTo(sFresh, 5);
  });
});
