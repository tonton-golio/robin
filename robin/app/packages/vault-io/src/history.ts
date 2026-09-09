/**
 * History substrate + edit-event log for the Robin vault.
 *
 * On each real page write, the storage transaction (1) snapshots the PRIOR bytes
 * to `<vaultRoot>/.history/<vault-path>/<ts>__<hash>.html`, (2) persists a
 * recovery receipt, (3) exposes canonical bytes, and (4) appends one immutable
 * event to `<vaultRoot>/inbox/robin/edits/<YYYY-MM>.jsonl`.
 *
 * `.history/` is a git-tracked sibling of the gitignored `.robin/` sidecar and is
 * invisible to the indexer (its scan globs only brain/ + out/). The edits stream
 * sits beside the annotation stream under inbox/robin/. See
 * robin/app/docs/edit-log-ingest.md.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { EditEvent, EditEventKind, EditOrigin } from "./types.js";
import { EDIT_SCHEMA_VERSION } from "./types.js";
import { computeDiffStat } from "./diff.js";
import {
  appendJsonlObjectOnce,
  assertVaultContained,
  durableWriteNew,
  fsyncDirectory,
} from "./durability.js";
import { listPendingMutations } from "./transactions.js";

const HISTORY_DIR = ".history";
/** Vault-relative dir of the edit-event stream (sibling of inbox/robin/annotations). */
const EDITS_DIR = "inbox/robin/edits";

/** Convert an absolute path under the vault to a POSIX vault-relative path. */
export function toVaultRelative(vaultRoot: string, absolutePath: string): string {
  return path.relative(vaultRoot, absolutePath).split(path.sep).join("/");
}

/** True for paths that ARE the edit-log substrate — never log edits to these. */
function isSubstratePath(rel: string): boolean {
  return rel.startsWith(`${HISTORY_DIR}/`) || rel.startsWith(`${EDITS_DIR}/`);
}

/**
 * Derive a cheap artifact-class label from a vault-relative path. Used to tag
 * edit events (schema v2) so the /edits list can badge them by kind without
 * re-reading the page. out/presentations→deck, out/<seg>→that segment,
 * brain/tasks→task, brain/*→brain, logs/*→log, everything else→page.
 */
export function deriveKind(rel: string): string {
  const parts = rel.split("/");
  const root = parts[0];
  if (root === "out") {
    if (parts[1] === "presentations") return "deck";
    return parts[1] || "page";
  }
  if (root === "brain") {
    if (parts[1] === "tasks") return "task";
    return "brain";
  }
  if (root === "logs") return "log";
  return "page";
}

/** Max stored title length — enough to be useful, small enough to stay compact. */
const TITLE_CAP = 200;

/**
 * Extract a display title from raw page HTML: prefer <title>, fall back to the
 * first <h1>. Returns undefined when neither yields text. Cheap regex only —
 * no DOM parse; strips inner tags and unescapes the minimal HTML entities.
 */
export function extractEventTitle(html: string): string | undefined {
  let raw = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (!raw || !raw.trim()) raw = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (!raw) return undefined;
  const text = raw
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > TITLE_CAP ? text.slice(0, TITLE_CAP) : text;
}

export interface RecordEditArgs {
  vaultRoot: string;
  absolutePath: string;
  /** Prior on-disk bytes (null for a create). Held in memory by the caller. */
  priorBytes: string | null;
  /** The new bytes just written. Enables schema-v2 title + diff_stat enrichment. */
  newBytes?: string;
  beforeHash: string | null;
  afterHash: string | null;
  origin?: EditOrigin;
  actor?: string;
  tool?: string;
  summary?: string;
  /** Override the event kind (e.g. 'edit.reverted' for a back-step). */
  eventKind?: EditEventKind;
  /** Stable transaction/event ID supplied by the storage transaction. */
  id?: string;
  /** Override the event's canonical page path (used by move). */
  pagePath?: string;
  /** Original path for edit.moved. */
  previousPath?: string;
  /** Path used for the prior-bytes snapshot (defaults to pagePath). */
  snapshotPath?: string;
  /** Recovery receipt ID correlating page bytes and the edit event. */
  transactionId?: string;
  /** Injected clock for deterministic tests. Defaults to now. */
  now?: Date;
}

/**
 * Prepare an edit event and durably snapshot prior bytes, without appending the
 * event yet. Storage transactions use this to write a recovery receipt before
 * making canonical bytes visible.
 */
export async function prepareEdit(args: RecordEditArgs): Promise<EditEvent | null> {
  const {
    vaultRoot,
    absolutePath,
    priorBytes,
    newBytes,
    beforeHash,
    afterHash,
    origin,
    actor,
    tool,
    summary,
  } = args;
  const rel = args.pagePath ?? toVaultRelative(vaultRoot, absolutePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (isSubstratePath(rel)) return null;

  const iso = (args.now ?? new Date()).toISOString();

  let snapshot: string | undefined;
  if (priorBytes !== null && beforeHash !== null) {
    snapshot = await writeSnapshot(
      vaultRoot,
      args.snapshotPath ?? rel,
      iso,
      beforeHash,
      priorBytes,
    );
  }

  // Schema-v2 enrichment (optional). title + diff_stat need the
  // new bytes; a caller that doesn't pass them still records a valid v2 event.
  const title = newBytes !== undefined ? extractEventTitle(newBytes) : undefined;
  const diffStat = newBytes !== undefined ? computeDiffStat(priorBytes ?? "", newBytes) : undefined;

  const event: EditEvent = {
    id: args.id ?? crypto.randomUUID(),
    event: args.eventKind ?? (beforeHash === null ? "edit.created" : "edit.saved"),
    page_path: rel,
    ...(args.previousPath ? { previous_path: args.previousPath } : {}),
    ts: iso,
    origin: origin ?? "agent",
    ...(actor ? { actor } : {}),
    ...(tool ? { tool } : {}),
    before_hash: beforeHash,
    after_hash: afterHash,
    ...(snapshot ? { snapshot } : {}),
    ...(summary ? { summary } : {}),
    status: "open",
    schema_version: EDIT_SCHEMA_VERSION,
    kind: deriveKind(rel),
    ...(title ? { title } : {}),
    ...(diffStat ? { diff_stat: diffStat } : {}),
    ...(args.transactionId ? { transaction_id: args.transactionId } : {}),
  };

  return event;
}

/**
 * Snapshot prior bytes and append one edit event. Kept as a public convenience
 * for callers that are not changing canonical page bytes themselves.
 */
export async function recordEdit(args: RecordEditArgs): Promise<EditEvent | null> {
  const event = await prepareEdit(args);
  if (event) await appendEditEvent(args.vaultRoot, event);
  return event;
}

/** ISO → filename-safe stamp: 2026-06-03T10:14:02.123Z → 2026-06-03T10-14-02Z */
function fileStamp(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

/** Reverse of {@link fileStamp}, for prune: parse the ts a snapshot filename encodes. */
function parseSnapshotTs(fileName: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z__/.exec(fileName);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function writeSnapshot(
  vaultRoot: string,
  rel: string,
  iso: string,
  beforeHash: string,
  priorBytes: string,
): Promise<string> {
  const fileName =
    `${fileStamp(iso)}__${beforeHash.slice(0, 12)}__` + `${crypto.randomUUID().slice(0, 8)}.html`;
  const relParts = rel.split("/");
  const relSnapshot = [HISTORY_DIR, ...relParts, fileName].join("/");
  const abs = path.join(vaultRoot, HISTORY_DIR, ...relParts, fileName);
  // Guard the snapshot write too: a symlink planted inside .history/ could
  // otherwise divert the prior-bytes copy outside the vault.
  await assertVaultContained(vaultRoot, abs);
  await durableWriteNew(abs, priorBytes);
  return relSnapshot;
}

/** Append one event to inbox/robin/edits/<YYYY-MM>.jsonl (month from event.ts). */
export async function appendEditEvent(vaultRoot: string, event: EditEvent): Promise<void> {
  const month = event.ts.slice(0, 7); // YYYY-MM
  await appendJsonlObjectOnce(vaultRoot, `inbox/robin/edits/${month}.jsonl`, event, "id");
}

export interface PruneHistoryOptions {
  /** Keep every snapshot newer than this many days. Default 30. */
  keepAllDays?: number;
  /** Between keepAllDays and this, keep one snapshot per calendar day. Default 90. */
  thinWeeklyAfterDays?: number;
  /** "Now" for age computation (tests pass a fixed date). Default new Date(). */
  now?: Date;
  /** When true, compute deletions but don't unlink anything. */
  dryRun?: boolean;
}

export interface PruneResult {
  scanned: number;
  kept: number;
  /** Snapshots retained because a durable edit event still references them. */
  preservedReferenced: number;
  deleted: number;
  deletedPaths: string[];
}

async function referencedSnapshots(vaultRoot: string): Promise<Set<string>> {
  const references = new Set<string>();
  const editsRoot = path.join(vaultRoot, EDITS_DIR);
  const entries = await fs.readdir(editsRoot, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.name.endsWith(".jsonl")) continue;
    if (!entry.isFile()) {
      throw new Error(`history_prune_blocked_by_non_file_ledger: ${entry.name}`);
    }
    const ledgerPath = path.join(editsRoot, entry.name);
    await assertVaultContained(vaultRoot, ledgerPath);
    const raw = await fs.readFile(ledgerPath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { snapshot?: unknown };
        if (
          typeof event.snapshot === "string" &&
          event.snapshot.startsWith(`${HISTORY_DIR}/`) &&
          !event.snapshot.split("/").includes("..")
        ) {
          references.add(event.snapshot);
        }
      } catch (error) {
        throw new Error(`history_prune_blocked_by_malformed_edit_event: ${entry.name}`, {
          cause: error,
        });
      }
    }
  }
  // A prepared snapshot can exist only in a pending receipt until the audit
  // event is finalized. It is recovery evidence and must be retained too.
  for (const pending of await listPendingMutations(vaultRoot)) {
    if (!pending.receipt) {
      throw new Error(`history_prune_blocked_by_invalid_receipt: ${pending.receiptPath}`);
    }
    const snapshot = pending.receipt.event.snapshot;
    if (snapshot && isSafeSnapshotReference(snapshot)) references.add(snapshot);
  }
  return references;
}

function isSafeSnapshotReference(snapshot: string): boolean {
  return (
    snapshot.startsWith(`${HISTORY_DIR}/`) &&
    !snapshot.includes("\\") &&
    !snapshot.split("/").some((segment) => segment === "." || segment === "..")
  );
}

/**
 * Thin unreferenced history: keep all snapshots < keepAllDays old; one per
 * calendar day between keepAllDays and thinWeeklyAfterDays; one per (epoch)
 * week beyond that. A snapshot named by a durable edit event is never silently
 * deleted; removing that guarantee requires an explicit expiry/tombstone event.
 */
export async function pruneHistory(
  vaultRoot: string,
  opts: PruneHistoryOptions = {},
): Promise<PruneResult> {
  const keepAllDays = opts.keepAllDays ?? 30;
  const thinWeeklyAfterDays = opts.thinWeeklyAfterDays ?? 90;
  const now = (opts.now ?? new Date()).getTime();
  const root = path.join(vaultRoot, HISTORY_DIR);
  const DAY = 86_400_000;

  const references = await referencedSnapshots(vaultRoot);
  const result: PruneResult = {
    scanned: 0,
    kept: 0,
    preservedReferenced: 0,
    deleted: 0,
    deletedPaths: [],
  };
  const byDir = new Map<string, Array<{ abs: string; ts: number }>>();
  await assertVaultContained(vaultRoot, root);

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        throw new Error(`history_prune_blocked_by_symlink: ${toVaultRelative(vaultRoot, full)}`);
      }
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name.endsWith(".html")) {
        const ts = parseSnapshotTs(e.name);
        if (!ts) continue;
        const arr = byDir.get(dir) ?? [];
        arr.push({ abs: full, ts: ts.getTime() });
        byDir.set(dir, arr);
        result.scanned++;
      }
    }
  }
  await walk(root);

  for (const snaps of byDir.values()) {
    const keep = new Set<string>();
    const dayKeeper = new Map<string, number>();
    const weekKeeper = new Map<number, number>();

    // First pass: pick the newest snapshot in each thinning bucket.
    for (const s of snaps) {
      const ageDays = (now - s.ts) / DAY;
      if (ageDays <= keepAllDays) {
        keep.add(s.abs);
      } else if (ageDays <= thinWeeklyAfterDays) {
        const dayKey = new Date(s.ts).toISOString().slice(0, 10);
        const cur = dayKeeper.get(dayKey);
        if (cur === undefined || s.ts > cur) dayKeeper.set(dayKey, s.ts);
      } else {
        const week = Math.floor(s.ts / (7 * DAY));
        const cur = weekKeeper.get(week);
        if (cur === undefined || s.ts > cur) weekKeeper.set(week, s.ts);
      }
    }
    // Second pass: mark the chosen per-day / per-week keepers.
    for (const s of snaps) {
      const ageDays = (now - s.ts) / DAY;
      if (ageDays <= keepAllDays) continue;
      if (ageDays <= thinWeeklyAfterDays) {
        const dayKey = new Date(s.ts).toISOString().slice(0, 10);
        if (dayKeeper.get(dayKey) === s.ts) keep.add(s.abs);
      } else {
        const week = Math.floor(s.ts / (7 * DAY));
        if (weekKeeper.get(week) === s.ts) keep.add(s.abs);
      }
    }
    for (const s of snaps) {
      const relative = toVaultRelative(vaultRoot, s.abs);
      if (references.has(relative)) {
        result.kept++;
        result.preservedReferenced++;
      } else if (keep.has(s.abs)) {
        result.kept++;
      } else {
        result.deleted++;
        result.deletedPaths.push(s.abs);
        if (!opts.dryRun) {
          await fs.unlink(s.abs);
          await fsyncDirectory(path.dirname(s.abs));
        }
      }
    }
  }

  return result;
}
