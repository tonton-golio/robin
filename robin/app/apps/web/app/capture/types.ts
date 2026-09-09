/**
 * Shared types for the Capture page (server loader ⇄ client surface).
 *
 * The capture page is the front door of the capture pipeline
 * (`inbox/ → brain/ → out/`). Its core legibility job is provenance: every
 * captured record shows WHO authored it — a live widget acting as Human, or
 * the Robin agent via an ingest skill — and WHETHER it is still raw in
 * `inbox/` or already ingested into a durable page under `logs/` / `brain/`.
 */

export type CaptureKind = 'meeting' | 'interview';
export type CaptureStatus = 'raw' | 'ingested';

/** Provenance of a captured record — the page's central distinction. */
export interface CaptureWriter {
  /** HUMAN = a widget captured on his behalf. ROBIN = the agent ingested it. */
  who: 'human' | 'robin';
  /** Human string, e.g. `meeting-widget (human)` or `robin · ingest-meeting`. */
  label: string;
  /** For agent writes: what it produced, e.g. `3 pages + 1 memory`. */
  wrote?: string;
}

/** One row in the session ledger. */
export interface CaptureSession {
  /** Stable id derived from the source path. */
  id: string;
  kind: CaptureKind;
  status: CaptureStatus;
  title: string;
  /** Vault-relative source of record (raw `.md` or the ingested `.html`). */
  sourcePath: string;
  /** Vault-relative rendered page — present once ingested. */
  pagePath?: string;
  /** Where "open" (Enter) navigates: rendered page or the raw file view. */
  href: string;
  writer: CaptureWriter;
  /** ISO timestamp used for sorting (file mtime / frontmatter date). */
  when: string;
  /** Short display label: `14:02`, `wed`, or a date. */
  whenLabel: string;
  date?: string;
  summary?: string;
  attendees: string[];
  /** First lines of the transcript / body, for the detail panel. */
  excerpt?: string;
  /**
   * For raw meeting sources only: the vault-relative path to POST to
   * `/api/ingest/meeting`. Absent for interviews (no local ingest route) and
   * for already-ingested rows.
   */
  ingestPath?: string;
  /** Mono glyph: `◑` meeting · `◍` agent-ingested · `●` note/interview. */
  glyph: string;
}

export type RecoveryKind = 'checkpoint' | 'live-interview' | 'audio';

/** A partial / stranded capture surfaced by the crash-recovery lane. */
export interface RecoveryItem {
  id: string;
  kind: RecoveryKind;
  title: string;
  /** Vault-relative path of the partial artifact. */
  sourcePath: string;
  /** Mono detail line describing origin + what was buffered. */
  detail: string;
  /** True for genuine interruptions (red left edge). */
  warn: boolean;
  glyph: string;
  /** ISO mtime for sorting. */
  when: string;
  /** Link to view the raw artifact (honest — no fake resume API). */
  href: string;
}

/** Freshness / backlog summary feeding the header + overloaded banner. */
export interface CaptureStats {
  /** Recovery-lane count. */
  unfinished: number;
  /** Raw (not-yet-ingested) sessions in the inbox. */
  inboxRaw: number;
  /** ISO of the most recent ingest, if any. */
  lastIngestIso?: string;
  /** e.g. `22m ago` or `—`. */
  lastIngestLabel: string;
  /** True when the inbox backlog is bloating (ingest fell behind). */
  degraded: boolean;
}

/** Full payload handed from the RSC to the client surface. */
export interface CaptureData {
  sessions: CaptureSession[];
  recovery: RecoveryItem[];
  stats: CaptureStats;
  /** Set when the loader itself failed (filesystem unreadable). */
  error?: string;
}
