'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Check, AlertTriangle } from 'lucide-react';

type State = 'idle' | 'running' | 'done' | 'error';

interface ResyncResponse {
  ok?: boolean;
  indexed?: number;
  wikilinks?: number;
  wikilinksKnown?: boolean;
  ambiguous?: number;
  errors?: number;
  mode?: 'indexer' | 'fallback';
  durationMs?: number;
  error?: string;
}

/** Hard cap so the button can never hang forever on a stuck indexer. */
const RESYNC_TIMEOUT_MS = 30_000;

interface Toast {
  kind: 'success' | 'error';
  title: string;
  detail?: string;
}

export function ResyncButton() {
  const [state, setState] = useState<State>('idle');
  const [toast, setToast] = useState<Toast | null>(null);
  const [mounted, setMounted] = useState(false);
  // Guard against concurrent runs with a ref, not `state`: the `robin:resync`
  // event listener is registered once and closes over the first-render `resync`,
  // whose `state` is frozen at 'idle' — so a state-based guard never trips for
  // event-driven runs.
  const runningRef = useRef(false);

  useEffect(() => setMounted(true), []);

  async function resync() {
    if (runningRef.current) return;
    runningRef.current = true;
    setState('running');
    setToast(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), RESYNC_TIMEOUT_MS);
    try {
      const res = await fetch('/api/resync', { method: 'POST', signal: controller.signal });
      const data = (await res.json().catch(() => ({}))) as ResyncResponse;

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const indexed = data.indexed ?? 0;
      const secs = data.durationMs ? (data.durationMs / 1000).toFixed(1) : null;
      const parts = [`${indexed} page${indexed === 1 ? '' : 's'}`];
      // Only ever report a link count when we actually know one — otherwise say
      // links are unavailable rather than printing a misleading "0 links".
      if (data.wikilinksKnown === false) {
        parts.push('links unavailable');
      } else {
        parts.push(`${data.wikilinks ?? 0} links`);
      }
      if (data.ambiguous) parts.push(`${data.ambiguous} ambiguous`);
      if (data.errors) parts.push(`${data.errors} errors`);

      setState('done');
      setToast({
        kind: 'success',
        // We only index brain/ + out/ — keep the wording honest about scope
        // rather than claiming the whole vault was resynced.
        title: data.mode === 'fallback' ? 'Reindexed brain + outputs (no index db)' : 'Reindexed brain + outputs',
        detail: `${parts.join(' · ')}${secs ? ` · ${secs}s` : ''}`,
      });
      window.setTimeout(() => setState('idle'), 1200);
      window.setTimeout(() => setToast(null), 4000);
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      setState('error');
      setToast({
        kind: 'error',
        title: 'Resync failed',
        detail: aborted ? `Timed out after ${RESYNC_TIMEOUT_MS / 1000}s` : (err as Error).message,
      });
      window.setTimeout(() => setState('idle'), 1600);
      window.setTimeout(() => setToast(null), 5000);
    } finally {
      window.clearTimeout(timeout);
      runningRef.current = false;
    }
  }

  useEffect(() => {
    function listener() {
      resync();
    }
    window.addEventListener('robin:resync', listener);
    return () => window.removeEventListener('robin:resync', listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Icon = state === 'done' ? Check : state === 'error' ? AlertTriangle : RefreshCw;

  return (
    <>
      <button
        type="button"
        className="robin-iconbtn"
        data-state={state}
        onClick={resync}
        disabled={state === 'running'}
        title={state === 'running' ? 'Resyncing vault…' : 'Resync vault'}
        aria-label="Resync vault"
        aria-busy={state === 'running'}
      >
        <Icon size={16} strokeWidth={1.5} />
      </button>
      {mounted &&
        toast &&
        createPortal(
          <div className="robin-toast" data-kind={toast.kind} role="status">
            <div className="robin-toast-title">{toast.title}</div>
            {toast.detail && <div className="robin-toast-detail">{toast.detail}</div>}
          </div>,
          document.body,
        )}
    </>
  );
}
