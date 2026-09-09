/**
 * Activity page — shared serializable model + pure grouping.
 *
 * This module is imported by BOTH the server loader (app/activity/load.ts) and
 * the client lenses, so it must stay free of any server-only imports (fs, the
 * vault libs). It defines the flat event shape the server hands the client and
 * the pure day → session → row grouping the ledger renders.
 *
 * Grouping semantics live here (not in a component) so agent-side summaries
 * ("Robin made 9 writes in 2 sessions") and the UI can share one definition:
 * a SESSION is a contiguous same-origin write burst (same origin + tool, gap
 * under SESSION_GAP_MS). Sessions are derived from the durable event stream.
 */

export type LedgerOrigin = 'human' | 'robin';
export type LedgerKind = 'created' | 'edited' | 'reverted' | 'deleted' | 'ingest';
export type ArtifactKind = 'page' | 'task' | 'deck' | 'other';

/** One flat ledger event (edit-log row or an ingest-log entry). Serializable. */
export interface LedgerEvent {
  id: string;
  /** ISO-8601 timestamp. */
  ts: string;
  origin: LedgerOrigin;
  /** Raw origin as recorded (web|mcp|agent|cli) — provenance detail, not identity. */
  originRaw: string;
  tool?: string;
  kind: LedgerKind;
  artifactKind: ArtifactKind;
  /** Vault-relative page path (empty for a bodyless ingest). */
  path: string;
  title: string;
  summary?: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  added: number;
  removed: number;
  /** Whether the edit carries a restorable snapshot (drives the Undo affordance). */
  hasSnapshot: boolean;
  /** Ingest source path (`inbox/NNN…`) when kind === 'ingest'. */
  src?: string;
  /** Event id this row reverted (revert rows). */
  reverts?: string;
  /** Event id that later reverted this row (undone rows). */
  revertedBy?: string;
}

/** A serializable comment/annotation row for the Comments lens. */
export interface CommentRow {
  id: string;
  status: string;
  kind: string;
  path: string;
  title: string;
  location: string;
  text?: string;
  quote?: string;
  resolutionMd?: string;
  resultLink?: string;
  ts: string;
  pageChanged?: boolean;
  pageHref: string | null;
  origin: LedgerOrigin;
  author?: string;
}

/** A serializable daily-session row for the Sessions lens. */
export interface SessionDay {
  date: string; // YYYY-MM-DD
  title: string;
  summary?: string;
  sessions: number;
  outcomes: string[];
  href: string;
}

/** JSONL parse health for the broken-log strip. Silent skipping is banned. */
export interface ParseHealth {
  linesTotal: number;
  linesSkipped: number;
  firstBadLine: number | null;
  file: string | null;
}

/** Everything the server hands the client. */
export interface ActivityData {
  edits: LedgerEvent[];
  comments: CommentRow[];
  sessions: SessionDay[];
  liveSession: { pid?: string; log?: string } | null;
  health: ParseHealth;
  logMeta: { editsFile: string; editsCount: number; annFile: string; annCount: number };
  rawLinks: { label: string; href: string }[];
  error?: string;
}

/** Contiguous-burst gap threshold. */
export const SESSION_GAP_MS = 10 * 60 * 1000;
/** Rows shown in full before a dense session folds its tail. */
export const BURST_HEAD = 8;
/** A session at or above this many rows is a dense "burst". */
export const BURST_THRESHOLD = 14;

export interface LedgerFilters {
  origin?: LedgerOrigin;
  kind?: LedgerKind;
  artifact?: ArtifactKind;
  path?: string;
}

export function filterEvents(events: LedgerEvent[], f: LedgerFilters): LedgerEvent[] {
  return events.filter((e) => {
    if (f.origin && e.origin !== f.origin) return false;
    if (f.kind && e.kind !== f.kind) return false;
    if (f.artifact && e.artifactKind !== f.artifact) return false;
    if (f.path && e.path !== f.path) return false;
    return true;
  });
}

/** Per-filter counts over the given (already path-scoped) event set. */
export function facetCounts(events: LedgerEvent[]) {
  const origin: Record<string, number> = { human: 0, robin: 0 };
  const kind: Record<string, number> = {};
  const artifact: Record<string, number> = {};
  for (const e of events) {
    origin[e.origin] = (origin[e.origin] ?? 0) + 1;
    kind[e.kind] = (kind[e.kind] ?? 0) + 1;
    artifact[e.artifactKind] = (artifact[e.artifactKind] ?? 0) + 1;
  }
  return { origin, kind, artifact };
}

export interface Session {
  key: string;
  origin: LedgerOrigin;
  tool?: string;
  events: LedgerEvent[];
  start: string;
  end: string;
}

export interface Day {
  date: string; // YYYY-MM-DD (local)
  sessions: Session[];
  eventCount: number;
}

/** YYYY-MM-DD in local time for a timestamp. */
export function localDay(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM month key for windowing. */
export function monthKey(ts: string): string {
  return ts.slice(0, 7);
}

/**
 * Group newest-first events into days → contiguous same-origin sessions.
 * A session breaks on: a new day, an origin change, a tool change, or a
 * time gap over SESSION_GAP_MS.
 */
export function groupIntoDays(events: LedgerEvent[]): Day[] {
  const sorted = [...events].sort((a, b) => b.ts.localeCompare(a.ts));
  const days: Day[] = [];
  let curDay: Day | null = null;
  let curSession: Session | null = null;
  let sessionOrdinal = 0;

  for (const e of sorted) {
    const dayKey = localDay(e.ts);
    if (!curDay || curDay.date !== dayKey) {
      curDay = { date: dayKey, sessions: [], eventCount: 0 };
      days.push(curDay);
      curSession = null;
    }
    curDay.eventCount += 1;

    const breaks =
      !curSession ||
      curSession.origin !== e.origin ||
      (curSession.tool ?? '') !== (e.tool ?? '') ||
      Math.abs(new Date(curSession.end).getTime() - new Date(e.ts).getTime()) > SESSION_GAP_MS;

    if (breaks || !curSession) {
      sessionOrdinal += 1;
      curSession = {
        key: `${dayKey}-${sessionOrdinal}-${e.id}`,
        origin: e.origin,
        tool: e.tool,
        events: [e],
        start: e.ts,
        end: e.ts,
      };
      curDay.sessions.push(curSession);
    } else {
      curSession.events.push(e);
      // newest-first: e.ts <= curSession.end, so it extends the start backwards
      curSession.start = e.ts;
    }
  }
  return days;
}

/** Explicit date-gap descriptors between consecutive shown days (>1 day apart). */
export interface DateGap {
  fromDate: string;
  toDate: string;
  days: number;
}

export function gapBetween(newerDay: string, olderDay: string): DateGap | null {
  const a = new Date(`${newerDay}T00:00:00`);
  const b = new Date(`${olderDay}T00:00:00`);
  const diff = Math.round((a.getTime() - b.getTime()) / (24 * 3600 * 1000));
  if (diff <= 1) return null;
  return { fromDate: olderDay, toDate: newerDay, days: diff - 1 };
}
