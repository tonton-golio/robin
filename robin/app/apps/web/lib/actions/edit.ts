'use server';

/**
 * Back-step (revert) server action for the edit log.
 *
 * Restores the prior-bytes snapshot an edit event captured by writing it back as
 * a NEW edit tagged 'edit.reverted'. This is a forward, always-safe operation
 * (an explicit "make the page look like this old version again") — not a
 * destructive rewind — so it itself appears in the edit log and is reversible.
 * See robin/app/docs/edit-log-ingest.md.
 */

import fs from 'fs/promises';
import path from 'path';
import { assertVaultContained, hashHtml, writeWithHistory } from '@robin/vault-io';
import { locateVault } from '@/lib/vault';
import { refreshIndexPaths } from '@/lib/indexer-client';
import { normalizeVaultFilePath } from '@/lib/vault-file';
import { findEdit } from '@/lib/edit-store';

export async function revertToSnapshot(
  eventId: string,
): Promise<{ ok: boolean; error?: string; path?: string; noop?: boolean }> {
  if (!eventId || typeof eventId !== 'string') {
    return { ok: false, error: 'missing eventId' };
  }

  const event = await findEdit(eventId);
  if (!event) return { ok: false, error: 'edit not found' };
  if (!event.snapshot) {
    return { ok: false, error: 'this edit has no snapshot to restore' };
  }

  const vault = locateVault();

  // The destination page must pass the vault allowlist (brain/inbox/out/logs).
  const safePage = normalizeVaultFilePath(event.page_path);
  if (!safePage) return { ok: false, error: 'invalid page path' };

  // The snapshot lives under .history/ (outside the served allowlist). Validate
  // it stays within that history root with no traversal before reading.
  const snapRel = event.snapshot;
  if (!snapRel.startsWith('.history/') || snapRel.includes('..') || snapRel.includes('\0')) {
    return { ok: false, error: 'invalid snapshot path' };
  }

  let priorHtml: string;
  try {
    const snapshotPath = path.join(vault, snapRel);
    await assertVaultContained(vault, snapshotPath);
    priorHtml = await fs.readFile(snapshotPath, 'utf-8');
  } catch {
    return { ok: false, error: 'snapshot file missing' };
  }

  try {
    const current = await fs.readFile(path.join(vault, safePage), 'utf8').catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    const res = await writeWithHistory({
      absolutePath: path.join(vault, safePage),
      html: priorHtml,
      origin: 'web',
      vaultRoot: vault,
      eventKind: 'edit.reverted',
      summary: `Reverted to the version from ${event.ts}`,
      expectedHash: current === null ? null : hashHtml(current),
    });
    if (res.written) {
      await refreshIndexPaths([safePage]).catch((error) => {
        console.warn('[edit] revert committed but index refresh failed:', error);
      });
    }
    // Byte-identical to current → the choke point skipped the write (already there).
    return { ok: true, path: safePage, noop: !res.written };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'revert failed' };
  }
}
