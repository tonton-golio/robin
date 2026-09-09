/**
 * Structured claims carried from the meeting review step into ingestion.
 *
 * The markdown transcript stays readable evidence. These signals are the
 * reviewed, machine-readable layer Robin can safely compile into durable
 * decisions, commitments, and judgment items without re-running an LLM.
 */

export type MeetingEvidenceState = 'reported' | 'inferred';

export interface MeetingDecisionSignal {
  id: string;
  text: string;
  evidenceState: MeetingEvidenceState;
}

export interface MeetingCommitmentSignal {
  id: string;
  text: string;
  owner: string | null;
  /** ISO date (YYYY-MM-DD) when known, otherwise null. */
  due: string | null;
  evidenceState: MeetingEvidenceState;
}

export interface MeetingConflictSignal {
  id: string;
  subject: string;
  existingValue: string;
  proposedValue: string;
  question: string;
}

export interface MeetingSignals {
  schemaVersion: 1;
  meetingId: string;
  reviewedAt: string;
  decisions: MeetingDecisionSignal[];
  commitments: MeetingCommitmentSignal[];
  conflicts: MeetingConflictSignal[];
}

export const EMPTY_MEETING_SIGNALS: MeetingSignals = {
  schemaVersion: 1,
  meetingId: '',
  reviewedAt: '',
  decisions: [],
  commitments: [],
  conflicts: [],
};

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function nullableString(value: unknown): string | null {
  const cleaned = cleanString(value);
  return cleaned || null;
}

function evidenceState(value: unknown): MeetingEvidenceState {
  // Unknown/legacy model output stays tentative. Only an explicit "reported"
  // label may promote a claim to the stronger evidence state.
  return value === 'reported' ? 'reported' : 'inferred';
}

function stableHash(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

function signalId(kind: string, explicit: unknown, identity: string): string {
  const candidate = cleanString(explicit).toLowerCase();
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(candidate)) return candidate;
  return `${kind}-${stableHash(`${kind}\0${identity}`)}`;
}

function validDateOnly(value: unknown): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
}

function assertUniqueSignalIds(kind: string, items: Array<{ id: string }>): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`duplicate_meeting_signal_id:${kind}:${item.id}`);
    seen.add(item.id);
  }
}

export function coerceMeetingSignals(raw: unknown): MeetingSignals {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const meetingId = /^[a-z0-9][a-z0-9_-]{0,95}$/i.test(cleanString(obj.meetingId))
    ? cleanString(obj.meetingId).toLowerCase()
    : '';
  const reviewedAtRaw = cleanString(obj.reviewedAt);
  const reviewedAt = Number.isNaN(new Date(reviewedAtRaw).getTime()) ? '' : reviewedAtRaw;

  const decisions = Array.isArray(obj.decisions)
    ? obj.decisions.flatMap((item): MeetingDecisionSignal[] => {
        if (typeof item === 'string') {
          const text = cleanString(item);
          return text ? [{ id: signalId('decision', null, text), text, evidenceState: 'inferred' }] : [];
        }
        if (!item || typeof item !== 'object') return [];
        const rec = item as Record<string, unknown>;
        const text = cleanString(rec.text);
        return text ? [{
          id: signalId('decision', rec.id, text),
          text,
          evidenceState: evidenceState(rec.evidenceState),
        }] : [];
      })
    : [];

  const commitmentInput = Array.isArray(obj.commitments)
    ? obj.commitments
    : Array.isArray(obj.actionItems)
      ? obj.actionItems
      : [];
  const commitments = commitmentInput.flatMap((item): MeetingCommitmentSignal[] => {
    if (typeof item === 'string') {
      const text = cleanString(item);
      return text ? [{
        id: signalId('commitment', null, text),
        text,
        owner: null,
        due: null,
        evidenceState: 'inferred',
      }] : [];
    }
    if (!item || typeof item !== 'object') return [];
    const rec = item as Record<string, unknown>;
    const text = cleanString(rec.text);
    if (!text) return [];
    return [{
      id: signalId('commitment', rec.id, JSON.stringify({ text, owner: nullableString(rec.owner), due: validDateOnly(rec.due) })),
      text,
      owner: nullableString(rec.owner),
      due: validDateOnly(rec.due),
      evidenceState: evidenceState(rec.evidenceState),
    }];
  });

  const conflicts = Array.isArray(obj.conflicts)
    ? obj.conflicts.flatMap((item): MeetingConflictSignal[] => {
        if (!item || typeof item !== 'object') return [];
        const rec = item as Record<string, unknown>;
        const subject = cleanString(rec.subject);
        const existingValue = cleanString(rec.existingValue);
        const proposedValue = cleanString(rec.proposedValue ?? rec.newValue);
        if (!subject || !existingValue || !proposedValue || existingValue === proposedValue) return [];
        const question = cleanString(rec.question)
          || `Should Robin use ${proposedValue} instead of ${existingValue} for ${subject}?`;
        return [{
          id: signalId('conflict', rec.id, JSON.stringify({ subject, existingValue, proposedValue })),
          subject,
          existingValue,
          proposedValue,
          question,
        }];
      })
    : [];

  assertUniqueSignalIds('decision', decisions);
  assertUniqueSignalIds('commitment', commitments);
  assertUniqueSignalIds('conflict', conflicts);

  return { schemaVersion: 1, meetingId, reviewedAt, decisions, commitments, conflicts };
}

export function hasMeetingSignals(signals: MeetingSignals): boolean {
  return signals.decisions.length > 0 || signals.commitments.length > 0 || signals.conflicts.length > 0;
}

/** Base64url keeps the line-oriented meeting frontmatter parser safe. */
export function encodeMeetingSignals(raw: unknown): string {
  const signals = coerceMeetingSignals(raw);
  return Buffer.from(JSON.stringify(signals), 'utf8').toString('base64url');
}

export function decodeMeetingSignals(encoded: string): MeetingSignals | null {
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    return coerceMeetingSignals(JSON.parse(decoded));
  } catch {
    return null;
  }
}
