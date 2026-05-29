/**
 * Pure decay scoring functions — no DB dependency.
 *
 * Implements the 4-tier Ebbinghaus decay model from the Robin spec.
 */

import type { Tier } from './types.js';

/** Decay half-life (τ) in days per tier */
const TAU: Record<Tier, number> = {
  working: 30,
  episodic: 90,
  semantic: 365,
  procedural: Infinity,
};

/** Map robin:type → Tier */
const TYPE_TO_TIER: Record<string, Tier> = {
  task: 'working',
  meeting: 'episodic',
  interview: 'episodic',
  brief: 'episodic',
  remsleep: 'episodic',
  person: 'semantic',
  project: 'semantic',
  knowledge: 'semantic',
  understanding: 'semantic',
  decision: 'semantic',
  reference: 'semantic',
  note: 'semantic',
  index: 'semantic',
  report: 'semantic',
  reflection: 'semantic',
  template: 'procedural',
  skill: 'procedural',
  playbook: 'procedural',
  pattern: 'procedural',
  standard: 'procedural',
};

/**
 * Assign a tier from robin:type, with optional override from robin:tier meta.
 */
export function assignTier(type: string, override?: string | null): Tier {
  if (override && isValidTier(override)) return override;
  return TYPE_TO_TIER[type] ?? 'semantic';
}

function isValidTier(s: string): s is Tier {
  return s === 'working' || s === 'episodic' || s === 'semantic' || s === 'procedural';
}

/**
 * Compute the recency score [0..1] for a page.
 *
 * recency = 1 for procedural (no decay)
 * recency = exp(-Δt_days / τ) otherwise
 *
 * Δt_days uses lastAccessed if available, else updated. If neither, defaults to 0 (fresh).
 */
export function computeRecency(
  tier: Tier,
  lastAccessed: string | null,
  updated: string | null,
  nowMs?: number
): number {
  if (tier === 'procedural') return 1;

  const now = nowMs ?? Date.now();
  const refIso = lastAccessed ?? updated;
  if (!refIso) return 1; // no date info → treat as fresh

  const refMs = new Date(refIso).getTime();
  if (isNaN(refMs)) return 1;

  const deltaDays = (now - refMs) / (1000 * 60 * 60 * 24);
  const tau = TAU[tier];
  return Math.exp(-deltaDays / tau);
}

/**
 * Compute the final search score, combining RRF score with decay and access boost.
 *
 * final_score = rrf_score * (0.4 + 0.6 * recency) + 0.1 * access_boost
 */
export function computeFinalScore(
  rrfScore: number,
  tier: Tier,
  access30d: number,
  lastAccessed: string | null,
  updated: string | null,
  nowMs?: number
): number {
  const recency = computeRecency(tier, lastAccessed, updated, nowMs);
  const accessBoost = Math.log2(1 + Math.max(0, access30d));
  return rrfScore * (0.4 + 0.6 * recency) + 0.1 * accessBoost;
}

/**
 * Compute staleness score [0..1].
 *
 * staleness = 1 - (0.4 + 0.6 * recency)
 * 0 = fresh, 1 = ancient
 */
export function computeStaleness(
  tier: Tier,
  lastAccessed: string | null,
  updated: string | null,
  nowMs?: number
): number {
  const recency = computeRecency(tier, lastAccessed, updated, nowMs);
  return 1 - (0.4 + 0.6 * recency);
}
