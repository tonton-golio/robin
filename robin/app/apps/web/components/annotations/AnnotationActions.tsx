'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isClosedAnnotationStatus } from '@/lib/annotations';

interface AnnotationActionsProps {
  id: string;
  status: string;
  pagePath?: string;
  renderPath?: string;
}

/**
 * Disposition controls for one comment in the Activity Comments lens.
 *
 * Resolve opens an inline resolution-note input ("what closed this?") saved to
 * `resolution_md` — the field the schema always had, finally populatable, so no
 * more canned "Resolved from Comments page." Needs-attention is one keystroke.
 * Reject is a red-bordered inline confirm before the status event is appended
 * (nothing acts on a rejected comment). Closed rows offer Reopen. All writes go
 * through PATCH /api/annotations and refresh the ledger.
 *
 * NOTE (reported): the store's status-event writer does not yet persist
 * `result_link`; a resolution's produced-artifact link is rendered on read but
 * cannot be written from here until the store accepts it.
 */
export function AnnotationActions({ id, status, pagePath, renderPath }: AnnotationActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const closed = isClosedAnnotationStatus(status);

  async function update(nextStatus: string, resolutionMd?: string) {
    setPending(nextStatus);
    setError(null);
    try {
      const res = await fetch('/api/annotations', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          status: nextStatus,
          page_path: pagePath,
          render_path: renderPath ?? pagePath,
          ...(resolutionMd ? { resolution_md: resolutionMd } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setResolveOpen(false);
      setRejectOpen(false);
      setNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  if (closed) {
    return (
      <div className="act-cactions">
        <button
          type="button"
          className="act-rowbtn"
          data-act="reopen"
          disabled={pending !== null}
          onClick={() => update('open')}
        >
          Reopen
        </button>
        {error ? <span className="act-rowbtn-err r-mono">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="act-cactions-wrap">
      <div className="act-cactions">
        <button
          type="button"
          className="act-rowbtn"
          data-act="resolve"
          disabled={pending !== null}
          onClick={() => {
            setResolveOpen((v) => !v);
            setRejectOpen(false);
          }}
        >
          Resolve
          <span className="act-rowbtn-key">r</span>
        </button>
        <button
          type="button"
          className="act-rowbtn"
          data-act="attention"
          disabled={pending !== null}
          onClick={() => update('needs-attention')}
        >
          Needs attention
          <span className="act-rowbtn-key">a</span>
        </button>
        <button
          type="button"
          className="act-rowbtn act-rowbtn--danger"
          data-act="reject"
          disabled={pending !== null}
          onClick={() => {
            setRejectOpen((v) => !v);
            setResolveOpen(false);
          }}
        >
          Reject
        </button>
        {error ? <span className="act-rowbtn-err r-mono">{error}</span> : null}
      </div>

      {resolveOpen ? (
        <form
          className="act-resolveform"
          onSubmit={(e) => {
            e.preventDefault();
            update('resolved', note.trim() || 'Resolved from the activity ledger.');
          }}
        >
          <input
            type="text"
            autoFocus
            placeholder="what closed this? (saved to resolution_md)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" className="r-btn r-btn--ink" disabled={pending !== null}>
            Save + resolve
          </button>
        </form>
      ) : null}

      {rejectOpen ? (
        <div className="act-rejectconfirm">
          <span>Marks it rejected — Robin will not act on it.</span>
          <button
            type="button"
            className="r-btn r-btn--danger"
            disabled={pending !== null}
            onClick={() => update('rejected', 'Rejected from the activity ledger.')}
          >
            Confirm reject
          </button>
          <button
            type="button"
            className="r-btn r-btn--ghost"
            disabled={pending !== null}
            onClick={() => setRejectOpen(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
