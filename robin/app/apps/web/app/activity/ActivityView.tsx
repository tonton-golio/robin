'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ActivityData, LedgerOrigin } from './model';
import { localDay } from './model';
import { LedgerLens } from './LedgerLens';
import { CommentsLens } from './CommentsLens';
import { SessionsLens } from './SessionsLens';

type Lens = 'ledger' | 'comments' | 'sessions';
const LENSES: Lens[] = ['ledger', 'comments', 'sessions'];
const WATERMARK_KEY = 'robin-activity-lastseen';

const OPEN_STATUSES = new Set(['open', 'needs-attention']);

/** Client-side seen watermark. Durable sidecar + rail badge are a foundation
 * concern (reported); here it lives in localStorage so unseen edges/mark-seen
 * work without a new API. */
function useWatermark(): [string | null, (v: string | null) => void] {
  const [watermark, setWatermarkState] = useState<string | null>(null);
  useEffect(() => {
    try {
      setWatermarkState(localStorage.getItem(WATERMARK_KEY));
    } catch {
      /* private mode */
    }
  }, []);
  const set = useCallback((v: string | null) => {
    setWatermarkState(v);
    try {
      if (v) localStorage.setItem(WATERMARK_KEY, v);
      else localStorage.removeItem(WATERMARK_KEY);
    } catch {
      /* ignore */
    }
  }, []);
  return [watermark, set];
}

export function ActivityView({ data }: { data: ActivityData }): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const lensParam = searchParams.get('lens');
  const lens: Lens = LENSES.includes(lensParam as Lens) ? (lensParam as Lens) : 'ledger';

  const [watermark, setWatermark] = useWatermark();

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setLens = useCallback((l: Lens) => setParam({ lens: l }), [setParam]);

  // Page-local keys: the shell owns global navigation and shortcut help.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '1') setLens('ledger');
      else if (e.key === '2') setLens('comments');
      else if (e.key === '3') setLens('sessions');
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setLens]);

  // ── tab counts ──────────────────────────────────────────────────────
  const unseenCount = useMemo(() => {
    const robin = data.edits.filter((e) => e.origin === 'robin');
    if (!watermark) return robin.length;
    return robin.filter((e) => e.ts > watermark).length;
  }, [data.edits, watermark]);

  const openComments = data.comments.filter((c) => OPEN_STATUSES.has(c.status));
  const needsAttention = data.comments.filter((c) => c.status === 'needs-attention').length;

  const today = localDay(new Date().toISOString());
  const todaySessions = data.sessions
    .filter((s) => s.date === today)
    .reduce((n, s) => n + Math.max(1, s.sessions), 0);

  const brokenLog = data.health.linesSkipped > 0;

  return (
    <div className="act-page">
      {data.error ? (
        <div className="act-error" role="alert">
          <span className="act-error-pill">Load failed</span>
          <span className="r-mono">{data.error}</span>
        </div>
      ) : null}

      <span className="r-bar">Activity</span>

      {/* lens tabs */}
      <div className="act-lenses" role="tablist" aria-label="Activity lens">
        <button
          className="act-lens"
          role="tab"
          aria-selected={lens === 'ledger'}
          onClick={() => setLens('ledger')}
          type="button"
        >
          Ledger
          <span className="act-lens-cnt">{unseenCount} unseen</span>
          <span className="act-lens-key">1</span>
        </button>
        <button
          className="act-lens"
          role="tab"
          aria-selected={lens === 'comments'}
          onClick={() => setLens('comments')}
          type="button"
        >
          Comments
          <span className="act-lens-cnt">
            {openComments.length} open{needsAttention ? ` · ${needsAttention} needs attention` : ''}
          </span>
          <span className="act-lens-key">2</span>
        </button>
        <button
          className="act-lens"
          role="tab"
          aria-selected={lens === 'sessions'}
          onClick={() => setLens('sessions')}
          type="button"
        >
          Sessions
          <span className="act-lens-cnt">{todaySessions} today</span>
          <span className="act-lens-key">3</span>
        </button>
      </div>

      {/* broken-log strip: never confusable with empty; the rest still renders */}
      {brokenLog ? (
        <div className="act-broken" role="alert">
          <span className="act-broken-pill">Log damaged</span>
          <span>
            {data.health.file}: <b>{data.health.linesSkipped} of {data.health.linesTotal} lines
            failed to parse</b> — the ledger below is missing those events. This is not an empty log;
            treat gaps with suspicion until repaired.
          </span>
          {data.health.firstBadLine ? (
            <span className="r-mono">first bad line: {data.health.firstBadLine}</span>
          ) : null}
          <a className="r-btn r-btn--ghost act-broken-link" href="/health">
            Open Health → logs
          </a>
        </div>
      ) : null}

      {/* active lens */}
      <div hidden={lens !== 'ledger'}>
        <LedgerLens
          data={data}
          active={lens === 'ledger'}
          watermark={watermark}
          onMarkSeen={() => setWatermark(new Date().toISOString())}
          filters={{
            origin: (searchParams.get('origin') as LedgerOrigin) || undefined,
            kind: (searchParams.get('kind') as never) || undefined,
            artifact: (searchParams.get('artifact') as never) || undefined,
            path: searchParams.get('path') || undefined,
          }}
          setParam={setParam}
        />
      </div>
      <div hidden={lens !== 'comments'}>
        <CommentsLens data={data} active={lens === 'comments'} />
      </div>
      <div hidden={lens !== 'sessions'}>
        <SessionsLens data={data} active={lens === 'sessions'} today={today} />
      </div>

      {/* raw-stream footer (escape hatch) */}
      <footer className="act-rawfoot">
        <span className="r-mono">append-only · nothing here is ever rewritten:</span>
        {data.rawLinks.map((l) => (
          <a key={l.href} className="r-mono act-rawlink" href={l.href}>
            {l.label}
          </a>
        ))}
      </footer>

    </div>
  );
}
