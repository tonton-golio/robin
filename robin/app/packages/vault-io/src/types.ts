/**
 * Shared types for @robin/vault-io.
 *
 * These describe the write choke point and the edit-event log it feeds. The
 * event stream is append-only JSONL with one immutable, uniquely identified
 * event per canonical mutation. See robin/app/docs/edit-log-ingest.md.
 */

export type EditOrigin = "web" | "mcp" | "agent" | "cli";

/** Current edit-event schema version. Stamped on every newly recorded event. */
export const EDIT_SCHEMA_VERSION = 2;

/** Added / removed line counts between the prior and new bytes of a page. */
export interface DiffStat {
  added: number;
  removed: number;
}

export type WriteEditEventKind = "edit.created" | "edit.saved" | "edit.reverted";

export interface WriteWithHistoryOptions {
  /** Absolute filesystem path of the page to write. */
  absolutePath: string;
  /** The full canonical HTML document to write. */
  html: string;
  /** Origin of the write (recorded on the edit event). */
  origin?: EditOrigin;
  /** Optional actor label (e.g. 'human', a tool name). */
  actor?: string;
  /** MCP tool name (e.g. 'page.write') when origin='mcp'. */
  tool?: string;
  /**
   * Vault root (absolute). When provided AND a write actually happens, the prior
   * bytes are snapshotted under `<vaultRoot>/.history/<rel>/` and an edit event
   * is appended to `<vaultRoot>/inbox/robin/edits/<YYYY-MM>.jsonl`. When omitted,
   * only the atomic write happens (Phase 0 behavior — no history).
   */
  vaultRoot?: string;
  /** Optional human/AI summary of the edit, recorded on the event. */
  summary?: string;
  /**
   * Override the event kind. Defaults to 'edit.created' (first write) or
   * 'edit.saved'. A back-step writes the restored bytes with 'edit.reverted'.
   */
  eventKind?: WriteEditEventKind;
  /**
   * Optional compare-and-swap precondition. A string requires the current file
   * to have that sha256; null requires the file to be absent. Omit for a
   * last-writer-wins write.
   */
  expectedHash?: string | null;
}

export interface WriteResult {
  /**
   * False when the new bytes were byte-identical to what was already on disk —
   * the write (and its mtime bump, re-index, and history) was skipped.
   */
  written: boolean;
  /** sha256 (hex) of the prior on-disk bytes, or null if the file did not exist. */
  beforeHash: string | null;
  /** sha256 (hex) of the new bytes. */
  afterHash: string;
  /** Echo of the absolute path. */
  absolutePath: string;
  /** Echo of the supplied origin, if any. */
  origin?: EditOrigin;
  /**
   * The edit event recorded — present when `vaultRoot` was supplied and a write
   * happened, null otherwise (no-op write or no vault context).
   */
  event?: EditEvent | null;
}

export type EditEventKind =
  | "edit.created"
  | "edit.saved"
  | "edit.moved"
  | "edit.deleted"
  | "edit.reverted";

/**
 * One immutable append-only edit-log event. Mutation IDs are unique; later
 * workflow state belongs in a separate stream rather than same-ID rewrites.
 */
export interface EditEvent {
  id: string;
  event: EditEventKind;
  /** Vault-relative path of the page that changed. */
  page_path: string;
  /** Prior vault-relative path for edit.moved. */
  previous_path?: string;
  /** ISO-8601 UTC timestamp. */
  ts: string;
  origin: EditOrigin;
  actor?: string;
  /** MCP tool name when origin='mcp'. */
  tool?: string;
  /** sha256 of the prior bytes (null for a create). */
  before_hash: string | null;
  /** sha256 of the new bytes (null for a delete). */
  after_hash: string | null;
  /** Vault-relative path to the prior-bytes snapshot under .history/ (absent for a create). */
  snapshot?: string;
  summary?: string;
  /** Workflow state captured when this immutable event was emitted. */
  status: string;

  // ── Schema v2 enrichment (all optional; v1 events omit them and still parse) ──
  /** Event schema version. Absent on v1 events; {@link EDIT_SCHEMA_VERSION} on new ones. */
  schema_version?: number;
  /** Artifact class derived cheaply from page_path (deck|report|brain|task|log|page…). */
  kind?: string;
  /** Human title of the new page (from <title> or first <h1>), length-capped. */
  title?: string;
  /** Added/removed line counts between prior and new bytes. */
  diff_stat?: DiffStat;
  /** Recovery receipt ID correlating the canonical mutation and this event. */
  transaction_id?: string;
}

export interface MoveWithHistoryOptions {
  vaultRoot: string;
  fromAbsolutePath: string;
  toAbsolutePath: string;
  origin?: EditOrigin;
  actor?: string;
  tool?: string;
  summary?: string;
  expectedHash?: string;
}

export interface MoveResult {
  moved: boolean;
  oldPath: string;
  newPath: string;
  beforeHash: string;
  afterHash: string;
  event: EditEvent | null;
}

export interface DeleteWithHistoryOptions {
  vaultRoot: string;
  absolutePath: string;
  origin?: EditOrigin;
  actor?: string;
  tool?: string;
  summary?: string;
  expectedHash?: string;
}

export interface DeleteResult {
  deleted: boolean;
  path: string;
  beforeHash: string;
  event: EditEvent;
}
