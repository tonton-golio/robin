/**
 * GET /api/edits/[id]/diff
 *
 * Compute the diff a single edit event introduced.
 *   before = the event's snapshot bytes (prior version); empty for a create.
 *   after  = the NEXT event for the same page's snapshot (its "prior" == this
 *            event's result); or, if this is the newest edit, the current file.
 *
 * Responses:
 *   200 { before_label, after_label, patch, diff_stat, after_stale?, truncated? }
 *   200 { before_label, after_label, too_large: true, diff_stat, after_stale? }
 *   410 { error: 'history-pruned' }  — this event's own snapshot is gone
 *   4xx { error }
 *
 * The diff is computed server-side (jsdiff via @robin/vault-io) so the client
 * only renders text — no diffing dependency ships to the browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { computeUnifiedPatch, computeDiffStat } from '@robin/vault-io';
import type { DiffStat } from '@robin/vault-io';
import { findEdit, listEdits } from '@/lib/edit-store';
import { locateVault } from '@/lib/vault';
import { normalizeVaultFilePath, resolveContainedVaultPath } from '@/lib/vault-file';

interface DiffRouteProps {
  params: Promise<{ id: string }>;
}

/** Per-side char ceiling: above this, skip the patch and return line counts only. */
const MAX_SIDE_CHARS = 1_000_000;
/** Total returned-patch ceiling (~200KB) so a huge page can't bloat the payload. */
const MAX_PATCH_CHARS = 200_000;

/** data:...;base64, payload marker — elided from the patch to keep it readable. */
const BASE64_LINE_RE = /data:[a-z/+;]*base64,/i;

/**
 * Replace patch lines that carry an inline base64 data URI with a short
 * placeholder, preserving the +/− diff prefix so tone classification still works.
 */
function elideBase64(patch: string): string {
  return patch
    .split('\n')
    .map((line) => {
      if (!BASE64_LINE_RE.test(line)) return line;
      const prefix = line[0] === '+' || line[0] === '-' ? line[0] : ' ';
      return `${prefix} <base64 data elided (${line.length} chars)>`;
    })
    .join('\n');
}

/** Read a validated .history/ snapshot; null on any containment or read failure. */
async function readSnapshot(vault: string, snapRel: string): Promise<string | null> {
  if (!snapRel.startsWith('.history/') || snapRel.includes('..') || snapRel.includes('\0')) {
    return null;
  }
  try {
    return await fs.readFile(path.join(vault, snapRel), 'utf-8');
  } catch {
    return null;
  }
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return 'new';
  return hash.replace(/^sha256:/, '').slice(0, 7);
}

export async function GET(_request: NextRequest, { params }: DiffRouteProps): Promise<NextResponse> {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const event = await findEdit(id);
  if (!event) return NextResponse.json({ error: 'edit not found' }, { status: 404 });

  const vault = locateVault();

  // ── before: the prior-bytes snapshot this event captured (absent for a create).
  let before = '';
  if (event.snapshot) {
    const snap = await readSnapshot(vault, event.snapshot);
    // The event's OWN snapshot is gone (pruned): the before-state can't be
    // reconstructed, so there is no meaningful diff to show — signal it distinctly.
    if (snap === null) return NextResponse.json({ error: 'history-pruned' }, { status: 410 });
    before = snap;
  }

  // ── after: the state this event produced. The chronologically NEXT edit of the
  // same page snapshots exactly those bytes as ITS prior version; if none exists,
  // this is the newest edit and the after-state is the live file on disk.
  //
  // F6 — deterministic ordering: listEdits returns newest-first, and for equal
  // timestamps preserves append order (readEditEvents reads append-ordered
  // files; the descending ts sort is stable). We sort ascending by ts with an
  // EXPLICIT tie-break on the original newest-first index (ascending) so that
  // same-ts events keep true append order without relying on sort stability.
  const newestFirst = await listEdits({ pagePath: event.page_path });
  const ascending = newestFirst
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const t = (a.e.ts || '').localeCompare(b.e.ts || '');
      return t !== 0 ? t : a.i - b.i;
    })
    .map((x) => x.e);
  const idx = ascending.findIndex((e) => e.id === id);
  const next = idx >= 0 ? ascending[idx + 1] : undefined;

  let after = '';
  let afterFromCurrent = false;
  let afterStale = false;
  if (next) {
    const snap = next.snapshot ? await readSnapshot(vault, next.snapshot) : null;
    if (snap !== null) {
      after = snap;
    } else {
      // The next snapshot is pruned/missing: fall back to the live file, which
      // now includes any edits made AFTER this one — flag it so the UI is honest.
      afterFromCurrent = true;
      afterStale = true;
    }
  } else {
    // This is the newest edit; the live file IS the true after-state.
    afterFromCurrent = true;
  }

  if (afterFromCurrent) {
    const safePage = normalizeVaultFilePath(event.page_path);
    if (safePage) {
      try {
        const real = await resolveContainedVaultPath(safePage);
        after = await fs.readFile(real, 'utf-8');
      } catch {
        // File deleted or unreadable — leave `after` empty (renders as a full deletion).
        after = '';
      }
    }
  }

  const beforeLabel = `${event.page_path} (${shortHash(event.before_hash)})`;
  const afterLabel = afterStale
    ? `${event.page_path} (current — later edits included)`
    : `${event.page_path} (${shortHash(event.after_hash)})`;

  // Reuse the stat stamped at write time when the after-side is this event's own
  // result (not the stale-current fallback); otherwise compute it (guarded for
  // huge payloads inside computeDiffStat).
  const diff_stat: DiffStat =
    !afterStale && event.diff_stat ? event.diff_stat : computeDiffStat(before, after);

  // Server-side cap: don't run the O(n·m) patch on multi-MB sides — return the
  // line counts only and let the client show a "too large" note.
  if (before.length > MAX_SIDE_CHARS || after.length > MAX_SIDE_CHARS) {
    return NextResponse.json({
      before_label: beforeLabel,
      after_label: afterLabel,
      too_large: true,
      diff_stat,
      ...(afterStale ? { after_stale: true } : {}),
    });
  }

  let patch = elideBase64(computeUnifiedPatch(beforeLabel, afterLabel, before, after));
  let truncated = false;
  if (patch.length > MAX_PATCH_CHARS) {
    patch = patch.slice(0, MAX_PATCH_CHARS);
    truncated = true;
  }

  return NextResponse.json({
    before_label: beforeLabel,
    after_label: afterLabel,
    patch,
    diff_stat,
    ...(afterStale ? { after_stale: true } : {}),
    ...(truncated ? { truncated: true } : {}),
  });
}
