'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EditDiff } from './EditDiff';

interface EditActionsProps {
  id: string;
  /** Whether this event carries a restorable snapshot. */
  hasSnapshot: boolean;
  /** Short hash of the snapshot that would be written back (for the copy). */
  snapshotHash?: string;
  /** 'deleted' tailors the copy ("Undo this delete? Restores the file…"). */
  kind?: string;
  /** Controlled panel state (Activity ledger drives this from the `u` key). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Suppress the built-in trigger button (panel visibility is controlled). */
  hideButton?: boolean;
  /** Called after a successful revert (e.g. to toast + refresh). */
  onReverted?: () => void;
}

/**
 * Undo control for one edit row. Never a one-click destruction: opening it
 * reveals a red-bordered confirm panel that states exactly what will happen —
 * the edit's prior snapshot is written back as a NEW `edit.reverted` event
 * (append-only, nothing erased) — and embeds a restore preview (the edit's diff)
 * so the change is visible before Confirm. POSTs to /api/edits then refreshes;
 * the reverted event surfaces at the top of the ledger. Formerly labeled
 * "Restore this version".
 */
export function EditActions({
  id,
  hasSnapshot,
  snapshotHash,
  kind,
  open: controlledOpen,
  onOpenChange,
  hideButton,
  onReverted,
}: EditActionsProps) {
  const router = useRouter();
  const isControlled = controlledOpen !== undefined;
  const [selfOpen, setSelfOpen] = useState(false);
  const open = isControlled ? controlledOpen : selfOpen;

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!hasSnapshot) return null;

  const isDelete = kind === 'deleted' || kind === 'delete';

  function setOpen(next: boolean) {
    if (isControlled) onOpenChange?.(next);
    else setSelfOpen(next);
  }

  async function confirmUndo() {
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/edits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'revert', id }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; noop?: boolean } | null;
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setDone(body?.noop ? 'Already at that version' : 'Undone');
      setOpen(false);
      onReverted?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {!hideButton ? (
        <button type="button" className="act-rowbtn" onClick={() => setOpen(!open)}>
          Undo this edit
          <span className="act-rowbtn-key">u</span>
        </button>
      ) : null}

      {open ? (
        <div className="act-undo" role="group" aria-label="Undo this edit">
          <div className="act-undo-title">{isDelete ? 'Undo this delete?' : 'Undo this edit?'}</div>
          <p>
            Writes snapshot{' '}
            {snapshotHash ? <span className="r-mono">{snapshotHash}</span> : 'the prior version'} back
            as a NEW <span className="r-mono">edit.reverted</span> event. The log stays append-only —
            nothing is erased. {isDelete ? 'Restores the file so you have it back.' : ''}
          </p>
          <EditDiff id={id} open onOpenChange={() => undefined} caption="restore preview" />
          <div className="act-undo-btns">
            <button
              type="button"
              className="r-btn r-btn--danger act-undo-confirm"
              disabled={pending}
              onClick={confirmUndo}
            >
              {pending ? 'Undoing…' : 'Confirm undo'}
            </button>
            <button
              type="button"
              className="r-btn r-btn--ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            {error ? <span className="act-rowbtn-err r-mono">{error}</span> : null}
          </div>
        </div>
      ) : null}

      {done && !open ? <span className="act-rowbtn-done r-mono">{done}</span> : null}
    </>
  );
}
