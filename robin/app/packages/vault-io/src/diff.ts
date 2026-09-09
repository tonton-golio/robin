/**
 * Line-diff helpers for the edit log (schema v2 + the /edits diff view).
 *
 * Thin wrappers over jsdiff so both the write path (recordEdit stamps a
 * diff_stat on each event) and the read path (the /api/edits/[id]/diff route
 * renders a unified patch) share one dependency and one line-counting rule.
 */

import { diffLines, createTwoFilesPatch } from 'diff';

/** Added / removed line counts between two revisions of a page. */
export interface DiffStat {
  added: number;
  removed: number;
}

/**
 * Char-length ceiling above which a synchronous jsdiff pass would block the
 * event loop for too long. Beyond this we approximate the diff instead (a cheap
 * line-count delta) rather than run diffLines/createTwoFilesPatch. Shared with
 * the diff route so the write path and read path draw the same line.
 */
export const HUGE_DIFF_THRESHOLD = 1_000_000;

/**
 * Count added/removed lines between `before` and `after`. A create (before was
 * absent) is passed as an empty string, so every line reads as added.
 *
 * For payloads larger than {@link HUGE_DIFF_THRESHOLD} (e.g. decks with big
 * base64 images) we skip the O(n·m) jsdiff pass and return a cheap line-count
 * delta — an approximation that never blocks the event loop.
 */
export function computeDiffStat(before: string, after: string): DiffStat {
  const b = before ?? '';
  const a = after ?? '';
  if (Math.max(b.length, a.length) > HUGE_DIFF_THRESHOLD) {
    const beforeLines = b === '' ? 0 : b.split('\n').length;
    const afterLines = a === '' ? 0 : a.split('\n').length;
    return {
      added: Math.max(0, afterLines - beforeLines),
      removed: Math.max(0, beforeLines - afterLines),
    };
  }
  let added = 0;
  let removed = 0;
  for (const part of diffLines(b, a)) {
    if (part.added) added += part.count ?? 0;
    else if (part.removed) removed += part.count ?? 0;
  }
  return { added, removed };
}

/**
 * A unified (git-style) patch between two revisions, ready to render. Labels are
 * cosmetic header lines (e.g. the page path + short hash of each side).
 */
export function computeUnifiedPatch(
  beforeLabel: string,
  afterLabel: string,
  before: string,
  after: string,
): string {
  return createTwoFilesPatch(beforeLabel, afterLabel, before ?? '', after ?? '', '', '');
}
