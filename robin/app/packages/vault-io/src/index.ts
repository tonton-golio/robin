/**
 * @robin/vault-io — the single write choke point for Robin vault HTML pages.
 *
 * Both writers route through {@link writeWithHistory}: the web app's
 * `apps/web/lib/write-page.ts` and the MCP server's
 * `packages/mcp-server/src/html-utils.ts` `writePage`. Funneling every page
 * mutation through ONE function — regardless of origin (human UI vs agent/MCP) —
 * is what lets the edit log be complete.
 *
 * It operates on an ABSOLUTE path (the lowest common denominator both callers
 * supply). When a `vaultRoot` is also passed, it records history: it snapshots
 * the prior bytes under `.history/` and appends an event to the edits stream
 * (see `./history.js`). See `robin/app/docs/edit-log-ingest.md`.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertVaultContained,
  durableReplace,
  VaultConflictError,
  withVaultLocks,
} from "./durability.js";
import { appendEditEvent, prepareEdit, toVaultRelative } from "./history.js";
import { assertPageIdentityTransition } from "./identity.js";
import {
  assertNoPendingMutationForPaths,
  MUTATION_RECEIPT_SCHEMA_VERSION,
  removeMutationReceipt,
  writeMutationReceipt,
} from "./transactions.js";
import type { WriteResult, WriteWithHistoryOptions } from "./types.js";

export { computeDiffStat, computeUnifiedPatch, HUGE_DIFF_THRESHOLD } from "./diff.js";
export type { VaultLockOptions } from "./durability.js";
export {
  appendJsonlObject,
  appendJsonlObjectOnce,
  assertVaultContained,
  durableCopyNew,
  durableReplace,
  durableWriteNew,
  fsyncDirectory,
  VaultConflictError,
  withVaultLocks,
} from "./durability.js";
export type { PruneHistoryOptions, PruneResult, RecordEditArgs } from "./history.js";
export {
  appendEditEvent,
  deriveKind,
  extractEventTitle,
  prepareEdit,
  pruneHistory,
  recordEdit,
  toVaultRelative,
} from "./history.js";
export { assertPageIdentityTransition } from "./identity.js";
export {
  deleteWithHistory,
  moveWithHistory,
  rewriteRobinPath,
} from "./lifecycle.js";
export type {
  MutationOperation,
  MutationReceipt,
  MutationRecoveryResult,
  PendingMutation,
} from "./transactions.js";
export {
  listPendingMutations,
  MUTATION_RECEIPT_SCHEMA_VERSION,
  recoverPendingMutations,
} from "./transactions.js";
export type {
  DeleteResult,
  DeleteWithHistoryOptions,
  DiffStat,
  EditEvent,
  EditEventKind,
  EditOrigin,
  MoveResult,
  MoveWithHistoryOptions,
  WriteEditEventKind,
  WriteResult,
  WriteWithHistoryOptions,
} from "./types.js";
export { EDIT_SCHEMA_VERSION } from "./types.js";

/** sha256 (hex) of a UTF-8 string. The content-identity key used for the no-op. */
export function hashHtml(html: string): string {
  return crypto.createHash("sha256").update(html, "utf8").digest("hex");
}

/**
 * Write a Robin HTML page atomically, skipping the write when the new content is
 * byte-identical to what is already on disk, and (when `vaultRoot` is given)
 * recording the prior version + an edit event.
 *
 * Atomicity: write to a unique (uuid) tmp file, then rename over the target; on
 * any failure the tmp file is removed before re-throwing so no `.tmp.<uuid>`
 * litters the vault.
 *
 * No-op on equal: hashing both sides lets a re-save or a revert producing
 * identical bytes skip the rename entirely (no mtime churn, no re-index, no
 * history entry).
 *
 * With a vault root, the mutation is fail-closed and recoverable: the prior
 * snapshot and a durable transaction receipt are prepared before canonical
 * bytes become visible. The edit event is appended after the rename and the
 * receipt is removed last. If that final append fails, the receipt remains for
 * `recoverPendingMutations({ repair: true })`, which may only finalize an event
 * after proving that the canonical bytes match the receipt.
 */
export async function writeWithHistory(opts: WriteWithHistoryOptions): Promise<WriteResult> {
  const { absolutePath, html, origin, actor, tool, vaultRoot, summary, eventKind, expectedHash } =
    opts;
  const afterHash = hashHtml(html);
  if (
    eventKind !== undefined &&
    !["edit.created", "edit.saved", "edit.reverted"].includes(eventKind)
  ) {
    throw new Error(`invalid_write_event_kind: ${String(eventKind)}`);
  }

  const execute = async (): Promise<WriteResult> => {
    if (vaultRoot) {
      // Recheck after acquiring the path lock. This narrows the check/use
      // window if a hostile local process swaps a parent directory while the
      // writer was waiting.
      await assertVaultContained(vaultRoot, absolutePath);
      const guardedPath = toVaultRelative(vaultRoot, absolutePath);
      await assertNoPendingMutationForPaths(vaultRoot, [guardedPath]);
    }
    let beforeHash: string | null = null;
    let priorBytes: string | null = null;
    try {
      priorBytes = await fs.readFile(absolutePath, "utf8");
      beforeHash = hashHtml(priorBytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (expectedHash !== undefined && beforeHash !== expectedHash) {
      throw new VaultConflictError(expectedHash, beforeHash);
    }

    assertPageIdentityTransition(priorBytes, html);

    if (beforeHash === afterHash) {
      return { written: false, beforeHash, afterHash, absolutePath, origin, event: null };
    }

    // A raw internal write still receives durable temp+rename+fsync semantics,
    // but cannot produce history or a cross-process vault lock without a root.
    if (!vaultRoot) {
      await durableReplace(absolutePath, html);
      return { written: true, beforeHash, afterHash, absolutePath, origin, event: null };
    }

    const relativePath = toVaultRelative(vaultRoot, absolutePath);
    const transactionId = crypto.randomUUID();
    const event = await prepareEdit({
      vaultRoot,
      absolutePath,
      priorBytes,
      newBytes: html,
      beforeHash,
      afterHash,
      origin,
      actor,
      tool,
      summary,
      eventKind,
      id: transactionId,
      transactionId,
    });

    // Edit-log substrate writes intentionally do not create recursive history.
    if (!event) {
      await durableReplace(absolutePath, html);
      return { written: true, beforeHash, afterHash, absolutePath, origin, event: null };
    }

    try {
      await writeMutationReceipt(vaultRoot, {
        schema_version: MUTATION_RECEIPT_SCHEMA_VERSION,
        transaction_id: transactionId,
        operation: "write",
        created_at: event.ts,
        target_path: relativePath,
        event,
      });
    } catch (error) {
      if (event.snapshot) {
        await fs
          .rm(path.join(vaultRoot, ...event.snapshot.split("/")), { force: true })
          .catch(() => {});
      }
      throw error;
    }

    let canonicalWritten = false;
    try {
      await durableReplace(absolutePath, html);
      canonicalWritten = true;
      await appendEditEvent(vaultRoot, event);
      await removeMutationReceipt(vaultRoot, transactionId);
    } catch (error) {
      if (!canonicalWritten) {
        const visibleBytes = await fs.readFile(absolutePath, "utf8").catch((readError) => {
          if ((readError as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw readError;
        });
        canonicalWritten = visibleBytes !== null && hashHtml(visibleBytes) === afterHash;
      }
      if (!canonicalWritten) {
        await removeMutationReceipt(vaultRoot, transactionId).catch(() => {});
        if (event.snapshot) {
          await fs
            .rm(path.join(vaultRoot, ...event.snapshot.split("/")), { force: true })
            .catch(() => {});
        }
      }
      // If bytes became visible but the event failed, keep the receipt. Doctor
      // fails closed and recoverPendingMutations({repair:true}) can finalize it.
      throw error;
    }

    return { written: true, beforeHash, afterHash, absolutePath, origin, event };
  };

  if (!vaultRoot) return execute();

  await assertVaultContained(vaultRoot, absolutePath);
  const relativePath = toVaultRelative(vaultRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`vault_path_escape: ${absolutePath}`);
  }
  return withVaultLocks(vaultRoot, [`page:${relativePath}`], execute);
}
