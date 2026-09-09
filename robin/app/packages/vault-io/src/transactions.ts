/**
 * Recoverable mutation receipts.
 *
 * A canonical mutation spans more than one filesystem object (page bytes,
 * history snapshot, JSONL audit event). The receipt is written before the
 * visible page change and removed only after the event is durable. A crash
 * therefore leaves an explicit, inspectable recovery item instead of silent
 * content/history divergence.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  appendJsonlObjectOnce,
  assertVaultContained,
  durableWriteNew,
  fsyncDirectory,
  withVaultLocks,
} from "./durability.js";
import type { EditEvent } from "./types.js";

export const MUTATION_RECEIPT_SCHEMA_VERSION = 1 as const;
const TRANSACTIONS_DIR = ".robin/transactions";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export type MutationOperation = "write" | "move" | "delete";

export interface MutationReceipt {
  schema_version: typeof MUTATION_RECEIPT_SCHEMA_VERSION;
  transaction_id: string;
  operation: MutationOperation;
  created_at: string;
  /** Final page path for write/move; removed page path for delete. */
  target_path: string;
  /** Original page path. Required for move, absent otherwise. */
  source_path?: string;
  /** Durable delete commit marker. Required only for delete. */
  tombstone_path?: string;
  event: EditEvent;
}

export interface PendingMutation {
  receiptPath: string;
  receipt?: MutationReceipt;
  error?: string;
}

export interface MutationRecoveryResult {
  transactionId: string;
  operation?: MutationOperation;
  status: "ready" | "incomplete" | "already-recorded" | "recovered" | "invalid";
  detail: string;
}

function receiptAbsolutePath(vaultRoot: string, transactionId: string): string {
  return path.join(vaultRoot, TRANSACTIONS_DIR, `${transactionId}.json`);
}

export function deleteTombstoneRelativePath(transactionId: string): string {
  return `${TRANSACTIONS_DIR}/${transactionId}.deleted`;
}

/** Persist a prepared receipt before making the canonical mutation visible. */
export async function writeMutationReceipt(
  vaultRoot: string,
  receipt: MutationReceipt,
): Promise<void> {
  const absolutePath = receiptAbsolutePath(vaultRoot, receipt.transaction_id);
  await assertVaultContained(vaultRoot, absolutePath);
  await durableWriteNew(absolutePath, `${JSON.stringify(receipt, null, 2)}\n`);
}

/** Remove a completed receipt and durably record its directory-entry removal. */
export async function removeMutationReceipt(
  vaultRoot: string,
  transactionId: string,
): Promise<void> {
  const absolutePath = receiptAbsolutePath(vaultRoot, transactionId);
  await assertVaultContained(vaultRoot, absolutePath);
  try {
    await fs.unlink(absolutePath);
    await fsyncDirectory(path.dirname(absolutePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function isReceipt(value: unknown): value is MutationReceipt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MutationReceipt>;
  const allowedReceiptKeys = new Set([
    "schema_version",
    "transaction_id",
    "operation",
    "created_at",
    "target_path",
    "source_path",
    "tombstone_path",
    "event",
  ]);
  if (Object.keys(candidate).some((key) => !allowedReceiptKeys.has(key))) return false;
  if (
    candidate.schema_version !== MUTATION_RECEIPT_SCHEMA_VERSION ||
    typeof candidate.transaction_id !== "string" ||
    !UUID_RE.test(candidate.transaction_id) ||
    !["write", "move", "delete"].includes(candidate.operation ?? "") ||
    typeof candidate.created_at !== "string" ||
    !isValidDateTime(candidate.created_at) ||
    !isSafeVaultRelativePath(candidate.target_path) ||
    !candidate.event ||
    typeof candidate.event !== "object"
  ) {
    return false;
  }
  if (
    (candidate.operation === "move") !== (typeof candidate.source_path === "string") ||
    (candidate.source_path !== undefined && !isSafeVaultRelativePath(candidate.source_path))
  ) {
    return false;
  }
  if (
    (candidate.operation === "delete") !== (typeof candidate.tombstone_path === "string") ||
    (candidate.tombstone_path !== undefined &&
      (!isSafeVaultRelativePath(candidate.tombstone_path) ||
        candidate.tombstone_path !== deleteTombstoneRelativePath(candidate.transaction_id)))
  ) {
    return false;
  }

  const event = candidate.event as Partial<EditEvent>;
  if (
    event.id !== candidate.transaction_id ||
    event.transaction_id !== candidate.transaction_id ||
    event.page_path !== candidate.target_path ||
    event.ts !== candidate.created_at ||
    typeof event.ts !== "string" ||
    !isValidDateTime(event.ts) ||
    !["agent", "cli", "mcp", "web"].includes(event.origin ?? "") ||
    event.status !== "open" ||
    event.schema_version !== 2 ||
    typeof event.kind !== "string" ||
    !event.kind ||
    (event.actor !== undefined && typeof event.actor !== "string") ||
    (event.tool !== undefined && typeof event.tool !== "string") ||
    (event.summary !== undefined && typeof event.summary !== "string") ||
    (event.title !== undefined && typeof event.title !== "string") ||
    (event.diff_stat !== undefined &&
      (!event.diff_stat ||
        typeof event.diff_stat !== "object" ||
        !Number.isInteger(event.diff_stat.added) ||
        event.diff_stat.added < 0 ||
        !Number.isInteger(event.diff_stat.removed) ||
        event.diff_stat.removed < 0)) ||
    (event.before_hash !== null &&
      (typeof event.before_hash !== "string" || !SHA256_RE.test(event.before_hash))) ||
    (event.after_hash !== null &&
      (typeof event.after_hash !== "string" || !SHA256_RE.test(event.after_hash)))
  ) {
    return false;
  }

  if (candidate.operation === "move") {
    return (
      event.event === "edit.moved" &&
      event.previous_path === candidate.source_path &&
      typeof event.before_hash === "string" &&
      event.after_hash !== null &&
      isSafeSnapshotPath(event.snapshot)
    );
  }
  if (event.previous_path !== undefined) return false;
  if (candidate.operation === "delete") {
    return (
      event.event === "edit.deleted" &&
      typeof event.before_hash === "string" &&
      event.after_hash === null &&
      isSafeSnapshotPath(event.snapshot)
    );
  }
  if (event.event === "edit.created") {
    return event.before_hash === null && event.after_hash !== null && event.snapshot === undefined;
  }
  return (
    ["edit.saved", "edit.reverted"].includes(event.event ?? "") &&
    typeof event.before_hash === "string" &&
    event.after_hash !== null &&
    isSafeSnapshotPath(event.snapshot)
  );
}

function isValidDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (days[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  if (match[7] !== "Z" && (Number(match[9]) > 23 || Number(match[10]) > 59)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function isSafeVaultRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.includes("\\") || path.posix.isAbsolute(value)) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isSafeSnapshotPath(value: unknown): value is string {
  return isSafeVaultRelativePath(value) && value.startsWith(".history/") && value.endsWith(".html");
}

/** Read all receipts without mutating them. Malformed receipts remain visible. */
export async function listPendingMutations(vaultRoot: string): Promise<PendingMutation[]> {
  const directory = path.join(vaultRoot, TRANSACTIONS_DIR);
  await assertVaultContained(vaultRoot, directory);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const pending: PendingMutation[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const receiptPath = path.join(TRANSACTIONS_DIR, entry.name).split(path.sep).join("/");
    try {
      const raw = await fs.readFile(path.join(directory, entry.name), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (
        !isReceipt(parsed) ||
        entry.name !== `${(parsed as Partial<MutationReceipt>).transaction_id}.json`
      ) {
        pending.push({ receiptPath, error: "invalid mutation receipt shape or version" });
      } else {
        pending.push({ receiptPath, receipt: parsed });
      }
    } catch (error) {
      pending.push({
        receiptPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return pending;
}

/**
 * Refuse a new canonical mutation while recovery evidence for the same path is
 * unresolved. Invalid receipts fail closed because their affected path cannot
 * be trusted.
 */
export async function assertNoPendingMutationForPaths(
  vaultRoot: string,
  vaultRelativePaths: string[],
): Promise<void> {
  const targets = new Set(vaultRelativePaths);
  for (const pending of await listPendingMutations(vaultRoot)) {
    if (!pending.receipt) {
      throw new Error(`vault_pending_mutation_invalid: ${pending.receiptPath}`);
    }
    if (
      targets.has(pending.receipt.target_path) ||
      (pending.receipt.source_path && targets.has(pending.receipt.source_path))
    ) {
      throw new Error(`vault_pending_mutation: ${pending.receipt.transaction_id}`);
    }
  }
}

function hashContents(contents: string): string {
  return crypto.createHash("sha256").update(contents, "utf8").digest("hex");
}

type RecordedEventState = "missing" | "same" | "conflict";

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, candidate) => {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return candidate;
  });
}

async function recordedEventState(
  vaultRoot: string,
  event: EditEvent,
): Promise<RecordedEventState> {
  const month = event.ts.slice(0, 7);
  const relativePath = `inbox/robin/edits/${month}.jsonl`;
  const eventPath = path.join(vaultRoot, ...relativePath.split("/"));
  return withVaultLocks(vaultRoot, [`jsonl:${relativePath}`], async () => {
    await assertVaultContained(vaultRoot, eventPath);
    const raw = await fs.readFile(eventPath, "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    let foundSame = false;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const candidate = JSON.parse(line) as { id?: unknown };
        if (candidate.id === event.id) {
          if (canonicalJson(candidate) !== canonicalJson(event)) return "conflict";
          foundSame = true;
        }
      } catch {
        // A malformed unrelated line is a doctor concern. It must not hide the
        // pending receipt or make recovery append duplicate IDs.
      }
    }
    return foundSame ? "same" : "missing";
  });
}

async function mutationReachedCanonicalState(
  vaultRoot: string,
  receipt: MutationReceipt,
  recordedEvent = false,
): Promise<{ reached: boolean; detail: string }> {
  const absolutePath = path.join(vaultRoot, ...receipt.target_path.split("/"));
  await assertVaultContained(vaultRoot, absolutePath);

  if (receipt.event.snapshot && typeof receipt.event.before_hash === "string") {
    const snapshotPath = path.join(vaultRoot, ...receipt.event.snapshot.split("/"));
    await assertVaultContained(vaultRoot, snapshotPath);
    const snapshot = await fs.readFile(snapshotPath, "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (snapshot === null || hashContents(snapshot) !== receipt.event.before_hash) {
      return {
        reached: false,
        detail: "prior-byte snapshot is missing or does not match before_hash",
      };
    }
  }

  if (receipt.operation === "delete") {
    if (await pathExists(absolutePath)) {
      return { reached: false, detail: "target still exists; delete did not commit" };
    }
    if (!receipt.tombstone_path) {
      return { reached: false, detail: "delete receipt is missing tombstone_path" };
    }
    const tombstonePath = path.join(vaultRoot, ...receipt.tombstone_path.split("/"));
    await assertVaultContained(vaultRoot, tombstonePath);
    const tombstone = await fs.readFile(tombstonePath, "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (tombstone === null) {
      if (recordedEvent) {
        return {
          reached: true,
          detail: "target is absent, snapshot matches, and the durable delete event is recorded",
        };
      }
      return {
        reached: false,
        detail: "target is absent but durable delete tombstone is missing",
      };
    }
    if (hashContents(tombstone) !== receipt.event.before_hash) {
      return {
        reached: false,
        detail: "delete tombstone does not match the intended before_hash",
      };
    }
    return { reached: true, detail: "target is absent and delete tombstone proves the commit" };
  }

  const contents = await fs.readFile(absolutePath, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (contents === null) {
    return { reached: false, detail: "target is missing" };
  }
  const actualHash = hashContents(contents);
  if (actualHash !== receipt.event.after_hash) {
    return {
      reached: false,
      detail:
        `target hash ${actualHash.slice(0, 12)} does not match intended ` +
        `${receipt.event.after_hash?.slice(0, 12) ?? "<missing>"}`,
    };
  }
  if (receipt.operation === "move") {
    if (!receipt.source_path) {
      return { reached: false, detail: "move receipt is missing source_path" };
    }
    const sourceAbsolutePath = path.join(vaultRoot, ...receipt.source_path.split("/"));
    await assertVaultContained(vaultRoot, sourceAbsolutePath);
    const sourceExists = await pathExists(sourceAbsolutePath);
    if (sourceExists) {
      return {
        reached: false,
        detail: "target bytes match, but the move source still exists",
      };
    }
  }
  return { reached: true, detail: "target bytes match the intended after_hash" };
}

async function removeDeleteTombstone(vaultRoot: string, receipt: MutationReceipt): Promise<void> {
  if (receipt.operation !== "delete") return;
  if (!receipt.tombstone_path) throw new Error("invalid_delete_receipt: missing tombstone_path");
  const absolutePath = path.join(vaultRoot, ...receipt.tombstone_path.split("/"));
  await assertVaultContained(vaultRoot, absolutePath);
  try {
    await fs.unlink(absolutePath);
    await fsyncDirectory(path.dirname(absolutePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Inspect pending receipts and, only with repair=true, finalize audit events for
 * mutations whose canonical state already matches the receipt. This never
 * writes page bytes, completes a delete, or guesses how to resolve divergence.
 */
export async function recoverPendingMutations(
  vaultRoot: string,
  options: { repair?: boolean } = {},
): Promise<MutationRecoveryResult[]> {
  const results: MutationRecoveryResult[] = [];
  const pendingMutations = await listPendingMutations(vaultRoot);
  const pathOwners = new Map<string, Set<string>>();
  for (const pending of pendingMutations) {
    if (!pending.receipt) continue;
    for (const affectedPath of new Set([
      pending.receipt.target_path,
      pending.receipt.source_path,
    ])) {
      if (!affectedPath) continue;
      const owners = pathOwners.get(affectedPath) ?? new Set<string>();
      owners.add(pending.receipt.transaction_id);
      pathOwners.set(affectedPath, owners);
    }
  }
  const conflictingPaths = new Map<string, string[]>();
  for (const [affectedPath, owners] of pathOwners) {
    if (owners.size < 2) continue;
    for (const owner of owners) {
      const paths = conflictingPaths.get(owner) ?? [];
      paths.push(affectedPath);
      conflictingPaths.set(owner, paths);
    }
  }

  for (const pending of pendingMutations) {
    if (!pending.receipt) {
      results.push({
        transactionId: path.basename(pending.receiptPath, ".json"),
        status: "invalid",
        detail: pending.error ?? "invalid receipt",
      });
      continue;
    }

    const receipt = pending.receipt;
    const overlap = conflictingPaths.get(receipt.transaction_id);
    if (overlap) {
      results.push({
        transactionId: receipt.transaction_id,
        operation: receipt.operation,
        status: "invalid",
        detail: `overlapping pending receipts affect ${overlap.sort().join(", ")}`,
      });
      continue;
    }
    const lockPaths = [receipt.target_path, receipt.source_path]
      .filter((item): item is string => Boolean(item))
      .map((item) => `page:${item}`);
    const result = await withVaultLocks(vaultRoot, lockPaths, async () => {
      // The original writer may have completed while recovery waited for its
      // path lock. Never act on a stale directory listing.
      if (!(await pathExists(receiptAbsolutePath(vaultRoot, receipt.transaction_id)))) {
        return null;
      }

      const eventState = await recordedEventState(vaultRoot, receipt.event);
      if (eventState === "conflict") {
        return {
          transactionId: receipt.transaction_id,
          operation: receipt.operation,
          status: "invalid" as const,
          detail: "ledger contains the transaction ID with a different immutable payload",
        };
      }
      if (eventState === "same") {
        const canonical = await mutationReachedCanonicalState(vaultRoot, receipt, true);
        if (!canonical.reached) {
          return {
            transactionId: receipt.transaction_id,
            operation: receipt.operation,
            status: "incomplete" as const,
            detail: `durable event exists, but recovery evidence diverged: ${canonical.detail}`,
          };
        }
        if (options.repair) {
          const month = receipt.event.ts.slice(0, 7);
          await appendJsonlObjectOnce(
            vaultRoot,
            `inbox/robin/edits/${month}.jsonl`,
            receipt.event,
            "id",
          );
          await removeDeleteTombstone(vaultRoot, receipt);
          await removeMutationReceipt(vaultRoot, receipt.transaction_id);
        }
        return {
          transactionId: receipt.transaction_id,
          operation: receipt.operation,
          status: "already-recorded" as const,
          detail: options.repair
            ? `${canonical.detail}; stale mutation artifacts removed`
            : `${canonical.detail}; mutation artifacts can be removed`,
        };
      }

      const canonical = await mutationReachedCanonicalState(vaultRoot, receipt);
      if (!canonical.reached) {
        return {
          transactionId: receipt.transaction_id,
          operation: receipt.operation,
          status: "incomplete" as const,
          detail: canonical.detail,
        };
      }

      if (!options.repair) {
        return {
          transactionId: receipt.transaction_id,
          operation: receipt.operation,
          status: "ready" as const,
          detail: `${canonical.detail}; audit event can be finalized`,
        };
      }

      const month = receipt.event.ts.slice(0, 7);
      await appendJsonlObjectOnce(
        vaultRoot,
        `inbox/robin/edits/${month}.jsonl`,
        receipt.event,
        "id",
      );
      await removeDeleteTombstone(vaultRoot, receipt);
      await removeMutationReceipt(vaultRoot, receipt.transaction_id);
      return {
        transactionId: receipt.transaction_id,
        operation: receipt.operation,
        status: "recovered" as const,
        detail: "audit event finalized and mutation artifacts removed",
      };
    });
    if (result) results.push(result);
  }
  return results;
}
