'use client';

import { useEffect, useState } from 'react';

interface EditDiffProps {
  id: string;
  /**
   * Controlled open state. When omitted the component manages its own state and
   * renders a trigger button (legacy behavior). When provided, the caller owns
   * visibility (used by the Activity ledger's keyboard-driven rows) and the
   * built-in button is suppressed unless `showButton` is also set.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render the built-in "Diff" trigger button even in controlled mode. */
  showButton?: boolean;
  /** Small caption shown above the diff (e.g. "restore preview"). */
  caption?: string;
}

interface DiffResponse {
  before_label: string;
  after_label: string;
  patch?: string;
  diff_stat: { added: number; removed: number };
  too_large?: boolean;
  truncated?: boolean;
  after_stale?: boolean;
  error?: string;
}

type LineTone = 'add' | 'del' | 'hunk' | 'meta' | 'ctx';

function classify(line: string): LineTone {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  if (line.startsWith('Index:') || line.startsWith('===')) return 'meta';
  return 'ctx';
}

const TONE_CLASS: Record<LineTone, string> = {
  add: 'r-diff-add',
  del: 'r-diff-del',
  hunk: 'r-diff-hunk',
  meta: 'r-diff-meta',
  ctx: 'r-diff-ctx',
};

/**
 * Per-row "Diff" affordance for the edit ledger. Lazily fetches the
 * server-computed unified patch for one edit and renders it as monospace +/−
 * lines — additions tinted blue, deletions red-struck (the identity's only
 * tolerated color tints). No diffing dependency ships to the browser: the route
 * hands back a ready-made patch string.
 *
 * Handles the route's edge responses: a 410 history-pruned edit, an after_stale
 * diff (compared against the live file), a too_large diff (line counts only),
 * and a truncated patch (capped ~200KB server-side).
 */
export function EditDiff({ id, open: controlledOpen, onOpenChange, showButton, caption }: EditDiffProps) {
  const isControlled = controlledOpen !== undefined;
  const [selfOpen, setSelfOpen] = useState(false);
  const open = isControlled ? controlledOpen : selfOpen;

  const [data, setData] = useState<DiffResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || data || pending) return;
    let cancelled = false;
    setPending(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/edits/${encodeURIComponent(id)}/diff`);
        const body = (await res.json().catch(() => null)) as DiffResponse | null;
        if (cancelled) return;
        if (res.status === 410 && body?.error === 'history-pruned') {
          setError('History pruned for this edit');
          return;
        }
        if (!res.ok || !body || body.error) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `data`/`pending` intentionally gate the one-shot fetch without re-arming it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  function toggle() {
    const next = !open;
    if (isControlled) onOpenChange?.(next);
    else setSelfOpen(next);
  }

  return (
    <div className="act-diff-wrap">
      {!isControlled || showButton ? (
        <button type="button" className="act-rowbtn" onClick={toggle} disabled={pending}>
          {open ? 'Hide diff' : pending ? 'Loading…' : 'Diff'}
          <span className="act-rowbtn-key">x</span>
        </button>
      ) : null}

      {open && error ? <p className="act-diff-error r-mono">{error}</p> : null}

      {open && data ? (
        <div className="act-diff">
          <div className="act-diff-head r-mono">
            <span>
              {caption ? `${caption} · ` : ''}
              <span className="r-diff-add">+{data.diff_stat.added}</span>{' '}
              <span className="r-diff-del">−{data.diff_stat.removed}</span>
              {data.after_stale ? ' · current (later edits included)' : ''}
            </span>
            <span>{data.after_label}</span>
          </div>
          {data.too_large ? (
            <p className="act-diff-note r-mono">
              Diff too large to render — showing line counts only (+{data.diff_stat.added} / −
              {data.diff_stat.removed}).
            </p>
          ) : (
            <>
              <pre className="act-diff-pre">
                {(data.patch ?? '').split('\n').map((line, i) => (
                  <span key={i} className={TONE_CLASS[classify(line)]}>
                    {line || ' '}
                  </span>
                ))}
              </pre>
              {data.truncated ? (
                <p className="act-diff-note r-mono">Patch truncated at 200 KB.</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
