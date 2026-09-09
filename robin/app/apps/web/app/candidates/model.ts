import { isOwner, OWNER_KEY } from '@/lib/owner-identity';
/**
 * Candidates page — shared serializable model + pure derivations.
 *
 * Imported by BOTH the server loader (app/candidates/load.ts) and the client
 * views, so it must stay free of server-only imports (fs, the vault libs).
 *
 * The pipeline is a MANUAL snapshot of Workable, not a live feed. That fact is
 * part of the model (`syncedAt`, `note`, `workableUrl`) rather than a UI
 * afterthought: every surface that shows a stage must be able to say how old
 * the reading is and where the system of record lives.
 */

export interface Stage {
  key: string;
  label: string;
}

/** One candidate row. Every date is `YYYY-MM-DD` or null; nothing is invented. */
export interface Candidate {
  name: string;
  email: string | null;
  /** Stage key — matches a `Stage.key` when the snapshot is consistent. */
  stage: string;
  challengeBrief: string | null;
  challengeInvitedOn: string | null;
  challengeSubmittedOn: string | null;
  interviewedOn: string | null;
  interviewScheduledFor: string | null;
  outcomeOn: string | null;
  lastContact: string | null;
  /** Who the ball is with: `human` | `candidate` | `closed` (free text tolerated). */
  owner: string;
  awaiting: string | null;
  flag: string | null;
  notes: string | null;
}

export interface Pipeline {
  role: string;
  workableRef: string | null;
  workableJobId: string | null;
  workableUrl: string | null;
  challengePlatform: string | null;
  /** `YYYY-MM-DD` the snapshot was taken. */
  syncedAt: string | null;
  syncedFrom: string[];
  note: string | null;
  stages: Stage[];
  candidates: Candidate[];
}

/* ── owner buckets ──────────────────────────────────────────────────── */

export const OWNER_SELF = OWNER_KEY || 'owner';
export const OWNER_CANDIDATE = 'candidate';
export const OWNER_CLOSED = 'closed';

export interface Summary {
  total: number;
  waitingOwner: number;
  waitingCandidate: number;
  active: number;
  closed: number;
}

export function summarise(candidates: Candidate[]): Summary {
  let waitingOwner = 0;
  let waitingCandidate = 0;
  let closed = 0;
  for (const c of candidates) {
    if (isOwner(c.owner)) waitingOwner += 1;
    else if (c.owner === OWNER_CANDIDATE) waitingCandidate += 1;
    if (c.owner === OWNER_CLOSED) closed += 1;
  }
  return {
    total: candidates.length,
    waitingOwner,
    waitingCandidate,
    active: candidates.length - closed,
    closed,
  };
}

/* ── the one date that matters per row ──────────────────────────────── */

export type DateKind = 'interview' | 'submitted' | 'contact' | 'none';

export interface PrimaryDate {
  kind: DateKind;
  /** `YYYY-MM-DD`, or null when the snapshot carries no date at all. */
  value: string | null;
}

/**
 * The single most decision-relevant date on a candidate: a booked interview
 * beats a challenge submission, which beats the last time anyone spoke.
 * Shared by the card date line and the table's "next date" column so the two
 * can never disagree.
 */
export function primaryDate(c: Candidate): PrimaryDate {
  if (c.interviewScheduledFor) return { kind: 'interview', value: c.interviewScheduledFor };
  if (c.challengeSubmittedOn) return { kind: 'submitted', value: c.challengeSubmittedOn };
  if (c.lastContact) return { kind: 'contact', value: c.lastContact };
  return { kind: 'none', value: null };
}

export const DATE_KIND_LABEL: Record<DateKind, string> = {
  interview: 'Interview',
  submitted: 'Submitted',
  contact: 'Last contact',
  none: 'No date',
};

/* ── grouping + sorting (pure) ──────────────────────────────────────── */

export interface Column {
  stage: Stage;
  candidates: Candidate[];
}

/**
 * One column per declared stage, in declared order, plus a trailing
 * "Unknown stage" column if the snapshot references a stage it never declared.
 * Silently dropping such a candidate would make the board lie about its count.
 */
export function groupByStage(pipeline: Pipeline): Column[] {
  const columns: Column[] = pipeline.stages.map((stage) => ({ stage, candidates: [] }));
  const byKey = new Map(columns.map((c) => [c.stage.key, c]));
  let unknown: Column | null = null;
  for (const c of pipeline.candidates) {
    const col = byKey.get(c.stage);
    if (col) {
      col.candidates.push(c);
      continue;
    }
    if (!unknown) {
      unknown = { stage: { key: '__unknown', label: 'Unknown stage' }, candidates: [] };
      columns.push(unknown);
    }
    unknown.candidates.push(c);
  }
  return columns;
}

export type SortKey = 'name' | 'stage' | 'owner' | 'awaiting' | 'lastContact' | 'nextDate';
export type SortDir = 'asc' | 'desc';

export const SORT_KEYS: SortKey[] = [
  'name',
  'stage',
  'owner',
  'awaiting',
  'lastContact',
  'nextDate',
];

export interface SortColumn {
  key: SortKey;
  label: string;
  /** Dates and other right-aligned, tabular-nums columns. */
  numeric: boolean;
}

export const SORT_COLUMNS: SortColumn[] = [
  { key: 'name', label: 'Name', numeric: false },
  { key: 'stage', label: 'Stage', numeric: false },
  { key: 'owner', label: 'Waiting on', numeric: false },
  { key: 'awaiting', label: 'Next action', numeric: false },
  { key: 'lastContact', label: 'Last contact', numeric: true },
  { key: 'nextDate', label: 'Next date', numeric: true },
];

export function isSortKey(v: string | null): v is SortKey {
  return v !== null && (SORT_KEYS as string[]).includes(v);
}

function stageRank(pipeline: Pipeline, stage: string): number {
  const idx = pipeline.stages.findIndex((s) => s.key === stage);
  return idx === -1 ? pipeline.stages.length : idx;
}

/** The comparable value behind a column. `null` means "the snapshot has none". */
function sortValue(pipeline: Pipeline, c: Candidate, key: SortKey): string | number | null {
  switch (key) {
    case 'stage':
      return stageRank(pipeline, c.stage);
    case 'owner':
      return c.owner;
    case 'awaiting':
      return c.awaiting;
    case 'lastContact':
      return c.lastContact;
    case 'nextDate':
      return primaryDate(c).value;
    default:
      return c.name;
  }
}

export function sortCandidates(pipeline: Pipeline, key: SortKey, dir: SortDir): Candidate[] {
  const flip = dir === 'desc' ? -1 : 1;
  const rows = [...pipeline.candidates];
  rows.sort((a, b) => {
    const av = sortValue(pipeline, a, key);
    const bv = sortValue(pipeline, b, key);

    // Absent values sort LAST in both directions. Folding them into the flip
    // would float "no date at all" to the top of a descending date sort, which
    // reads as the newest movement in the pipeline — the opposite of the truth.
    if (av === null && bv === null) return a.name.localeCompare(b.name);
    if (av === null) return 1;
    if (bv === null) return -1;

    const base =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
    if (base !== 0) return base * flip;
    // Name is the stable tiebreak so equal keys never reorder between renders;
    // it follows the flip only when name IS the sort key.
    return a.name.localeCompare(b.name) * (key === 'name' ? flip : 1);
  });
  return rows;
}

/* ── presentation lookups (static literal strings only) ─────────────── */

/**
 * Flag → tone class. Every value is a complete literal class string (the
 * Tailwind JIT and a CSS-class lookup share the same constraint: nothing may be
 * built by interpolation). Unknown flags fall back to the neutral tone rather
 * than disappearing, so a new flag in the snapshot is still visible.
 */
export const FLAG_CLASS: Record<string, string> = {
  strong: 'cand-flag is-good',
  new: 'cand-flag is-accent',
  fresh_invite: 'cand-flag is-accent',
  blocked_on_owner: 'cand-flag is-warn',
  stale: 'cand-flag is-warn',
  stalled: 'cand-flag is-warn',
  untouched: 'cand-flag is-warn',
  platform_problem: 'cand-flag is-warn',
  no_reply: 'cand-flag is-neutral',
  replied_asked_for_time: 'cand-flag is-neutral',
  too_junior: 'cand-flag is-neutral',
  blocked_on_timing: 'cand-flag is-neutral',
  profile_mismatch: 'cand-flag is-warn',
  record_mismatch: 'cand-flag is-bad',
};

export const FLAG_LABEL: Record<string, string> = {
  strong: 'Strong',
  new: 'New',
  fresh_invite: 'Fresh invite',
  blocked_on_owner: 'Waiting on you',
  stale: 'Stale',
  stalled: 'Stalled',
  untouched: 'Untouched',
  platform_problem: 'Platform problem',
  no_reply: 'No reply',
  replied_asked_for_time: 'Asked for time',
  too_junior: 'Too junior for this seat',
  blocked_on_timing: 'Blocked on timing',
  profile_mismatch: 'Profile mismatch',
  record_mismatch: 'Record mismatch',
};

export function flagClass(flag: string): string {
  if (OWNER_KEY && flag === `blocked_on_${OWNER_KEY}`) flag = 'blocked_on_owner';
  return FLAG_CLASS[flag] ?? 'cand-flag is-neutral';
}

export function flagLabel(flag: string): string {
  if (OWNER_KEY && flag === `blocked_on_${OWNER_KEY}`) flag = 'blocked_on_owner';
  return FLAG_LABEL[flag] ?? flag.replace(/[-_]+/g, ' ');
}

export const OWNER_CLASS: Record<string, string> = {
  human: 'cand-owner is-human',
  candidate: 'cand-owner is-candidate',
  closed: 'cand-owner is-closed',
};

export const OWNER_LABEL: Record<string, string> = {
  human: 'Human',
  candidate: 'Candidate',
  closed: 'Closed',
};

export function ownerClass(owner: string): string {
  if (isOwner(owner)) return 'cand-owner is-human';
  return OWNER_CLASS[owner] ?? 'cand-owner is-other';
}

export function ownerLabel(owner: string): string {
  if (isOwner(owner)) return 'You';
  return OWNER_LABEL[owner] ?? owner;
}

/** Stage label for a key, falling back to the raw key (never blank). */
export function stageLabel(pipeline: Pipeline, key: string): string {
  return pipeline.stages.find((s) => s.key === key)?.label ?? key;
}

/** `2026-07-27` → `27 Jul 2026`. Non-dates pass through untouched. */
export function formatDate(value: string | null): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const month = months[Number(m[2]) - 1] ?? m[2];
  return `${Number(m[3])} ${month} ${m[1]}`;
}
