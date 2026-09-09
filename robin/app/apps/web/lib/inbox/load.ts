import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCaptures } from '@/app/capture/data';
import { locateVault } from '@/lib/vault';
import {
  buildInboxData,
  extractFiledSourcePaths,
  type InboxData,
} from './model';

/**
 * Load Inbox from the existing capture filesystem reader, then apply the
 * lifecycle distinction the old all-sessions ledger did not need: sources
 * with a durable ingest receipt no longer belong in the primary queue.
 *
 * If the optional receipt cannot be read, fail open and show the raw source.
 * Showing an extra safe file is preferable to silently hiding unfiled work.
 */
export async function loadInbox(): Promise<InboxData> {
  const captures = await loadCaptures();
  if (captures.error) return buildInboxData(captures);

  let filedSourcePaths = new Set<string>();
  try {
    const vault = locateVault();
    const log = await fs.readFile(
      path.join(/*turbopackIgnore: true*/ vault, 'logs', 'ingest-log.md'),
      'utf8',
    );
    filedSourcePaths = extractFiledSourcePaths(log);
  } catch {
    // Missing/temporarily unreadable history must not make current work vanish.
  }

  return buildInboxData(captures, filedSourcePaths);
}
