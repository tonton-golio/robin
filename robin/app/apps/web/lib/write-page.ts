/**
 * Atomic file writer for Robin HTML pages (web/UI write path).
 *
 * Delegates to @robin/vault-io `writeWithHistory` — the single write choke point
 * shared with the MCP server — which does the atomic tmp+rename and the
 * content-hash no-op, and is where history snapshots + the edit-event log will
 * hook in (see robin/app/docs/edit-log-ingest.md). This wrapper only resolves the
 * vault-relative path to an absolute one and tags the origin; the brain/inbox/
 * out/logs allowlist stays in each caller (normalizeVaultFilePath) as before.
 */

import { vaultPath, locateVault } from "./vault";
import { writeWithHistory } from "@robin/vault-io";
import { refreshIndexPaths } from "./indexer-client";

export interface WritePageOptions {
  /** Vault-relative path, e.g. 'brain/my-page.html' */
  vaultRelativePath: string;
  html: string;
  /** CAS precondition: hash string for update, null for create-only. */
  expectedHash?: string | null;
}

export async function writePage({
  vaultRelativePath,
  html,
  expectedHash,
}: WritePageOptions): Promise<void> {
  const absolutePath = vaultPath(vaultRelativePath);
  // Passing vaultRoot turns on history: prior bytes are snapshotted under
  // base/.history/ and an edit event is appended to base/inbox/robin/edits/.
  const result = await writeWithHistory({
    absolutePath,
    html,
    origin: "web",
    vaultRoot: locateVault(),
    expectedHash,
  });
  if (result.written) {
    await notifyIndexerWrite(vaultRelativePath).catch((error) => {
      // The canonical write already committed. Do not turn a derived-index
      // refresh failure into a false mutation failure and a dangerous retry.
      console.warn(
        `[write-page] write committed but index refresh failed for ${vaultRelativePath}:`,
        error,
      );
    });
  }
}

/**
 * Notify the indexer of a write.
 *
 * Uses the live indexer's in-process incremental refresh. The indexer also runs
 * a watcher for manual/direct writes; refresh marks the path as self-written so
 * that watcher event is suppressed rather than indexed twice.
 */
export async function notifyIndexerWrite(vaultRelativePath: string): Promise<void> {
  await refreshIndexPaths([vaultRelativePath]);
}
