/**
 * Atomic file writer for Robin HTML pages.
 *
 * Writes via tmp file + rename to prevent partial writes.
 * After write, optionally notifies the indexer if the route exists.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { vaultPath } from './vault';

export interface WritePageOptions {
  /** Vault-relative path, e.g. 'brain/my-page.html' */
  vaultRelativePath: string;
  html: string;
}

export async function writePage({ vaultRelativePath, html }: WritePageOptions): Promise<void> {
  const absPath = vaultPath(vaultRelativePath);
  const dir = path.dirname(absPath);
  // Unique tmp name per write: two writes to the same page in the same
  // millisecond would otherwise collide on `Date.now()` and race the rename.
  const tmpPath = `${absPath}.tmp.${crypto.randomUUID()}`;

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  // Atomic write: write to tmp, then rename. If the write or rename fails, the
  // tmp file would otherwise be orphaned on disk (e.g. ENOSPC mid-write, or a
  // rename failure across a mount), accumulating `.tmp.<uuid>` litter next to
  // the page. Clean it up on any failure before re-throwing.
  try {
    await fs.writeFile(tmpPath, html, 'utf-8');
    await fs.rename(tmpPath, absPath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Notify the indexer of a write.
 *
 * No-op: there is no incremental indexer-notify pathway. Re-indexing is a full
 * scan triggered explicitly via POST /api/resync (see lib/indexer-client
 * `reindex`); the old `/api/indexer/notify-write` route never existed, so this
 * previously fired a 404 round-trip on every single write. (A 404 is a resolved
 * Response, not a thrown error, so the former try/catch never even caught it.)
 *
 * The export is retained because several write paths call it fire-and-forget;
 * keeping the no-op avoids touching those call sites. If incremental indexing is
 * ever wired up, implement it here behind the existing callers.
 */
export async function notifyIndexerWrite(_vaultRelativePath: string): Promise<void> {
  // intentionally empty — see doc comment.
}
