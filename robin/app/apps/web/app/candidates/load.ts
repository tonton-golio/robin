/**
 * Candidates page — server-side loader.
 *
 * Reads the manual hiring snapshot at `.robin/hiring/r69-pipeline.json` straight
 * off the filesystem. That path is NOT reachable through `/api/file` (which
 * allowlists brain|inbox|out|logs only), so there is no client fetch and no SWR
 * here: the page is a plain RSC read.
 *
 * House style follows lib/calendar.ts — validate the shape defensively, swallow
 * the error, return `null` when the file is missing or unparseable so the page
 * renders an honest empty state instead of a 500.
 */

import 'server-only';
import fs from 'node:fs/promises';
import { vaultPath } from '@/lib/vault';
import type { Candidate, Pipeline, Stage } from './model';

const PIPELINE_FILE = ['.robin', 'hiring', 'r69-pipeline.json'];

/** Vault-relative path, shown in the UI so the reading is traceable. */
export const PIPELINE_REL_PATH = PIPELINE_FILE.join('/');

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

function toStage(v: unknown): Stage | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as Record<string, unknown>;
  const key = str(raw['key']);
  if (!key) return null;
  return { key, label: str(raw['label']) ?? key };
}

function toCandidate(v: unknown): Candidate | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as Record<string, unknown>;
  const name = str(raw['name']);
  if (!name) return null; // a nameless row is not a candidate
  return {
    name,
    email: str(raw['email']),
    stage: str(raw['stage']) ?? 'unknown',
    challengeBrief: str(raw['challenge_brief']),
    challengeInvitedOn: str(raw['challenge_invited_on']),
    challengeSubmittedOn: str(raw['challenge_submitted_on']),
    interviewedOn: str(raw['interviewed_on']),
    interviewScheduledFor: str(raw['interview_scheduled_for']),
    outcomeOn: str(raw['outcome_on']),
    lastContact: str(raw['last_contact']),
    owner: str(raw['owner']) ?? 'unknown',
    awaiting: str(raw['awaiting']),
    flag: str(raw['flag']),
    notes: str(raw['notes']),
  };
}

/**
 * Load the hiring pipeline snapshot.
 * Returns null when the file is missing, unreadable, not JSON, or does not
 * carry both a `stages` and a `candidates` array — anything less cannot be
 * rendered as a pipeline without inventing structure.
 */
export async function loadPipeline(): Promise<Pipeline | null> {
  try {
    const raw = await fs.readFile(vaultPath(...PIPELINE_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj['stages']) || !Array.isArray(obj['candidates'])) return null;

    const stages = obj['stages'].map(toStage).filter((s): s is Stage => s !== null);
    const candidates = obj['candidates'].map(toCandidate).filter((c): c is Candidate => c !== null);
    if (stages.length === 0) return null;

    return {
      role: str(obj['role']) ?? 'Open role',
      workableRef: str(obj['workable_ref']),
      workableJobId: str(obj['workable_job_id']),
      workableUrl: str(obj['workable_url']),
      challengePlatform: str(obj['challenge_platform']),
      syncedAt: str(obj['synced_at']),
      syncedFrom: strList(obj['synced_from']),
      note: str(obj['note']),
      stages,
      candidates,
    };
  } catch {
    return null; // missing or unparseable — the page says so
  }
}
