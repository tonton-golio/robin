import type {
  CaptureData,
  CaptureSession,
  RecoveryItem,
} from '@/app/capture/types';

const BACKLOG_ALARM = 12;

export interface InboxStats {
  /** Raw, unfiled meeting and interview sources requiring attention. */
  pending: number;
  /** Partial artifacts that can be inspected and recovered. */
  recovery: number;
  /** Durable meeting/interview pages, kept outside the primary queue. */
  history: number;
  /** Raw source files left in place after a successful ingest. */
  alreadyFiledSources: number;
  lastIngestLabel: string;
  degraded: boolean;
}

export interface InboxData {
  pending: CaptureSession[];
  recovery: RecoveryItem[];
  history: CaptureSession[];
  stats: InboxStats;
  error?: string;
}

/**
 * The ingest log is the durable receipt that connects an inbox source to its
 * promoted output. Keep this parser deliberately narrow: a coincidental path
 * elsewhere in the log must never make a raw capture disappear from Inbox.
 */
export function extractFiledSourcePaths(log: string): Set<string> {
  return new Set(
    [...log.matchAll(/^\s*-\s+\*\*source\*\*:\s*`([^`\r\n]+)`\s*$/gm)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

/**
 * Turn the legacy capture ledger into the Inbox lifecycle view.
 *
 * The source files intentionally remain in the vault after ingest. A raw row
 * with an ingest receipt is therefore history, not new work, and is removed
 * from the default queue without deleting or mutating anything.
 */
export function buildInboxData(
  captures: CaptureData,
  filedSourcePaths: ReadonlySet<string> = new Set(),
): InboxData {
  const raw = captures.sessions.filter((session) => session.status === 'raw');
  const pending = raw.filter((session) => !filedSourcePaths.has(session.sourcePath));
  const history = captures.sessions.filter((session) => session.status === 'ingested');
  const alreadyFiledSources = raw.length - pending.length;

  return {
    pending,
    recovery: captures.recovery,
    history,
    stats: {
      pending: pending.length,
      recovery: captures.recovery.length,
      history: history.length,
      alreadyFiledSources,
      lastIngestLabel: captures.stats.lastIngestLabel,
      degraded: pending.length >= BACKLOG_ALARM,
    },
    ...(captures.error ? { error: captures.error } : {}),
  };
}

export type { CaptureSession, RecoveryItem };
