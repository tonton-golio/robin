/**
 * Canonical page lifecycle operations.
 *
 * Move/archive/delete must use the same containment, locking, history, audit,
 * and recovery semantics as writes. Raw fs.rename/fs.unlink calls leave
 * robin:path, snapshots, edit events, and projections disagreeing.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { upsertHeadMetaTag } from "@robin/converter";
import {
  assertVaultContained,
  durableWriteNew,
  fsyncDirectory,
  VaultConflictError,
  withVaultLocks,
} from "./durability.js";
import { appendEditEvent, prepareEdit, toVaultRelative } from "./history.js";
import { assertPageIdentityTransition } from "./identity.js";
import {
  assertNoPendingMutationForPaths,
  deleteTombstoneRelativePath,
  MUTATION_RECEIPT_SCHEMA_VERSION,
  removeMutationReceipt,
  writeMutationReceipt,
} from "./transactions.js";
import type {
  DeleteResult,
  DeleteWithHistoryOptions,
  MoveResult,
  MoveWithHistoryOptions,
} from "./types.js";

function hashContents(contents: string): string {
  return crypto.createHash("sha256").update(contents, "utf8").digest("hex");
}

function safeRelativePath(vaultRoot: string, absolutePath: string): string {
  const relativePath = toVaultRelative(vaultRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`vault_path_escape: ${absolutePath}`);
  }
  return relativePath;
}

/**
 * Rewrite canonical robin:path metadata without re-rendering the body or
 * dropping unknown metadata. Inserts the tag when a legacy page lacks it.
 */
export function rewriteRobinPath(html: string, newPath: string): string {
  return upsertHeadMetaTag(html, "robin:path", newPath);
}

async function destinationExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Move or archive a page while preserving its immutable content identity and
 * recording the path transition. The destination is never overwritten.
 */
export async function moveWithHistory(options: MoveWithHistoryOptions): Promise<MoveResult> {
  const {
    vaultRoot,
    fromAbsolutePath,
    toAbsolutePath,
    origin,
    actor,
    tool,
    summary,
    expectedHash,
  } = options;

  await assertVaultContained(vaultRoot, fromAbsolutePath);
  await assertVaultContained(vaultRoot, toAbsolutePath);
  const oldPath = safeRelativePath(vaultRoot, fromAbsolutePath);
  const newPath = safeRelativePath(vaultRoot, toAbsolutePath);

  return withVaultLocks(vaultRoot, [`page:${oldPath}`, `page:${newPath}`], async () => {
    await assertVaultContained(vaultRoot, fromAbsolutePath);
    await assertVaultContained(vaultRoot, toAbsolutePath);
    await assertNoPendingMutationForPaths(vaultRoot, [oldPath, newPath]);
    const priorBytes = await fs.readFile(fromAbsolutePath, "utf8");
    const beforeHash = hashContents(priorBytes);
    if (expectedHash !== undefined && beforeHash !== expectedHash) {
      throw new VaultConflictError(expectedHash, beforeHash);
    }

    if (path.resolve(fromAbsolutePath) === path.resolve(toAbsolutePath)) {
      return {
        moved: false,
        oldPath,
        newPath,
        beforeHash,
        afterHash: beforeHash,
        event: null,
      };
    }
    if (await destinationExists(toAbsolutePath)) {
      throw new Error(`vault_destination_exists: ${newPath}`);
    }

    const nextBytes = rewriteRobinPath(priorBytes, newPath);
    assertPageIdentityTransition(priorBytes, nextBytes);
    const afterHash = hashContents(nextBytes);
    const transactionId = crypto.randomUUID();
    const event = await prepareEdit({
      vaultRoot,
      absolutePath: toAbsolutePath,
      priorBytes,
      newBytes: nextBytes,
      beforeHash,
      afterHash,
      origin,
      actor,
      tool,
      summary,
      eventKind: "edit.moved",
      id: transactionId,
      transactionId,
      pagePath: newPath,
      previousPath: oldPath,
      snapshotPath: oldPath,
    });
    if (!event) throw new Error(`invalid_lifecycle_path: ${oldPath}`);

    await writeMutationReceipt(vaultRoot, {
      schema_version: MUTATION_RECEIPT_SCHEMA_VERSION,
      transaction_id: transactionId,
      operation: "move",
      created_at: event.ts,
      target_path: newPath,
      source_path: oldPath,
      event,
    });

    const stagedPath = `${toAbsolutePath}.tmp.${transactionId}`;
    let destinationPublished = false;
    try {
      await durableWriteNew(stagedPath, nextBytes);
      // Publish with link(2), which is atomically create-exclusive. Unlike
      // rename(2), it cannot overwrite a destination created by a raw writer
      // between our existence check and commit.
      await fs.link(stagedPath, toAbsolutePath);
      destinationPublished = true;
      await fsyncDirectory(path.dirname(toAbsolutePath));
      await fs.unlink(fromAbsolutePath);
      await fsyncDirectory(path.dirname(fromAbsolutePath));
      await fs.unlink(stagedPath);
      await fsyncDirectory(path.dirname(stagedPath));
      await appendEditEvent(vaultRoot, event);
      await removeMutationReceipt(vaultRoot, transactionId);
    } catch (error) {
      await fs.rm(stagedPath, { force: true }).catch(() => {});
      if (!destinationPublished) {
        await removeMutationReceipt(vaultRoot, transactionId).catch(() => {});
        if (event.snapshot) {
          await fs
            .rm(path.join(vaultRoot, ...event.snapshot.split("/")), { force: true })
            .catch(() => {});
        }
      }
      // Once the destination became visible the receipt intentionally stays.
      // If source removal did not complete, recovery reports an incomplete
      // move rather than guessing which side to delete.
      throw error;
    }

    return { moved: true, oldPath, newPath, beforeHash, afterHash, event };
  });
}

/** Permanently delete a page with a prior-byte snapshot and durable event. */
export async function deleteWithHistory(options: DeleteWithHistoryOptions): Promise<DeleteResult> {
  const { vaultRoot, absolutePath, origin, actor, tool, summary, expectedHash } = options;

  await assertVaultContained(vaultRoot, absolutePath);
  const relativePath = safeRelativePath(vaultRoot, absolutePath);

  return withVaultLocks(vaultRoot, [`page:${relativePath}`], async () => {
    await assertVaultContained(vaultRoot, absolutePath);
    await assertNoPendingMutationForPaths(vaultRoot, [relativePath]);
    const priorBytes = await fs.readFile(absolutePath, "utf8");
    const beforeHash = hashContents(priorBytes);
    if (expectedHash !== undefined && beforeHash !== expectedHash) {
      throw new VaultConflictError(expectedHash, beforeHash);
    }

    const transactionId = crypto.randomUUID();
    const event = await prepareEdit({
      vaultRoot,
      absolutePath,
      priorBytes,
      beforeHash,
      afterHash: null,
      origin,
      actor,
      tool,
      summary,
      eventKind: "edit.deleted",
      id: transactionId,
      transactionId,
    });
    if (!event) throw new Error(`invalid_lifecycle_path: ${relativePath}`);

    const tombstonePath = deleteTombstoneRelativePath(transactionId);
    const tombstoneAbsolutePath = path.join(vaultRoot, ...tombstonePath.split("/"));
    await assertVaultContained(vaultRoot, tombstoneAbsolutePath);
    await writeMutationReceipt(vaultRoot, {
      schema_version: MUTATION_RECEIPT_SCHEMA_VERSION,
      transaction_id: transactionId,
      operation: "delete",
      created_at: event.ts,
      target_path: relativePath,
      tombstone_path: tombstonePath,
      event,
    });

    let tombstonePublished = false;
    try {
      // A create-exclusive hard link is the durable delete commit marker.
      // Unlike rename(2), it cannot overwrite a pre-existing tombstone. The
      // target is unlinked only after the proof name is durable.
      await fs.link(absolutePath, tombstoneAbsolutePath);
      tombstonePublished = true;
      await fsyncDirectory(path.dirname(tombstoneAbsolutePath));
      await fs.unlink(absolutePath);
      await fsyncDirectory(path.dirname(absolutePath));
      await appendEditEvent(vaultRoot, event);
      await fs.unlink(tombstoneAbsolutePath);
      await fsyncDirectory(path.dirname(tombstoneAbsolutePath));
      await removeMutationReceipt(vaultRoot, transactionId);
    } catch (error) {
      if (!tombstonePublished) {
        await removeMutationReceipt(vaultRoot, transactionId).catch(() => {});
        if (event.snapshot) {
          await fs
            .rm(path.join(vaultRoot, ...event.snapshot.split("/")), { force: true })
            .catch(() => {});
        }
      }
      // Once the proof name exists, leave both it and the receipt intact even
      // if source unlink failed. Recovery will report the still-present target
      // as incomplete instead of guessing which inode name to remove.
      throw error;
    }

    return {
      deleted: true,
      path: relativePath,
      beforeHash,
      event,
    };
  });
}
