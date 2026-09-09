'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  mapPageHit,
  mapMemoryHit,
  queryTerms,
  type UIHit,
  type Corpus,
  type SearchApiResponse,
  type KnowledgeApiResponse,
} from './lib';
import { ResultRow } from './ResultRow';

const K = 100;
const MIN_QUERY = 2;
const RECENTS_KEY = 'robin-recent-searches';

const SINCE_DAYS: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30 };

const TYPE_PILLS = ['note', 'task', 'decision', 'hub', 'source', 'artifact'];
const STATUS_PILLS: { value: string; label: string }[] = [
  { value: 'active', label: 'active' },
  { value: 'waiting', label: 'waiting' },
  { value: 'done', label: 'done' },
  { value: 'overdue', label: 'overdue' },
];
const SINCE_PILLS: { value: string; label: string }[] = [
  { value: '24h', label: 'edited <24h' },
  { value: '7d', label: 'edited <7d' },
  { value: '30d', label: 'edited <30d' },
];

type RunState = 'idle' | 'short' | 'loading' | 'error' | 'ready';

interface FetchState {
  runState: RunState;
  hits: UIHit[];
  /** 'indexer' (ranked) or 'fallback' (grep — degraded). */
  mode: 'indexer' | 'fallback';
  /** Memory hits suppressed because the grep fallback can't rank events.jsonl. */
  memorySuppressed: number;
  /** True when the server returned exactly the k cap — the set is larger. */
  capped: boolean;
  error?: { call: string; status: number };
}

interface RecentQuery {
  q: string;
  count: number;
  at: number;
}

/** Mirror of the shell's typing-target guard so page single-key shortcuts stay
 *  dormant while the query field (or any field) has focus. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function readRecents(): RecentQuery[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentQuery =>
        !!r && typeof (r as RecentQuery).q === 'string' && typeof (r as RecentQuery).at === 'number',
    );
  } catch {
    return [];
  }
}

export function SearchView(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL is the source of truth for the committed query + filters.
  const committedQ = (searchParams.get('q') ?? '').trim();
  const corpus = (searchParams.get('corpus') ?? 'all') as Corpus | 'all';
  const typeFilter = searchParams.get('type');
  const statusFilter = searchParams.get('status');
  const sinceFilter = searchParams.get('since');

  const [input, setInput] = useState(committedQ);
  const [state, setState] = useState<FetchState>({
    runState: committedQ ? 'loading' : 'idle',
    hits: [],
    mode: 'indexer',
    memorySuppressed: 0,
    capped: false,
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [recents, setRecents] = useState<RecentQuery[]>([]);
  const [resyncNonce, setResyncNonce] = useState(0);

  const queryRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input mirrored to the URL query (palette Enter, back/forward, deep link).
  useEffect(() => {
    setInput(committedQ);
  }, [committedQ]);

  useEffect(() => {
    setRecents(readRecents());
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1900);
  }, []);

  const rememberQuery = useCallback((q: string, count: number) => {
    const next = [{ q, count, at: Date.now() }, ...readRecents().filter((r) => r.q !== q)].slice(0, 8);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      /* private mode — skip persistence */
    }
    setRecents(next);
  }, []);

  // ── Fetch: keyed on the committed query + a resync nonce ──────────────────
  useEffect(() => {
    if (!committedQ) {
      setState((s) => ({ ...s, runState: 'idle' }));
      return;
    }
    if (committedQ.length < MIN_QUERY) {
      setState((s) => ({ ...s, runState: 'short' }));
      return;
    }

    let cancelled = false;
    const enc = encodeURIComponent(committedQ);
    const terms = queryTerms(committedQ);
    setState((s) => ({ ...s, runState: 'loading' }));

    (async () => {
      let pages: SearchApiResponse;
      try {
        const res = await fetch(`/api/search?q=${enc}&k=${K}`, { headers: { accept: 'application/json' } });
        if (!res.ok) {
          if (!cancelled) {
            setState({
              runState: 'error',
              hits: [],
              mode: 'indexer',
              memorySuppressed: 0,
              capped: false,
              error: { call: `GET /api/search?q=${enc}&k=${K}`, status: res.status },
            });
          }
          return;
        }
        pages = (await res.json()) as SearchApiResponse;
      } catch {
        if (!cancelled) {
          setState({
            runState: 'error',
            hits: [],
            mode: 'indexer',
            memorySuppressed: 0,
            capped: false,
            error: { call: `GET /api/search?q=${enc}&k=${K}`, status: 0 },
          });
        }
        return;
      }

      const degraded = pages.mode === 'fallback';
      const pageHits = (pages.hits ?? []).map(mapPageHit);

      // Memory comes from /api/knowledge (MCP memory-search over events.jsonl —
      // independent of the page index). It's best-effort: if it fails, the
      // memory corpus is simply empty, never an error.
      let memoryHits: UIHit[] = [];
      try {
        const kres = await fetch(`/api/knowledge?q=${enc}&k=50`, { headers: { accept: 'application/json' } });
        if (kres.ok) {
          const kd = (await kres.json()) as KnowledgeApiResponse;
          memoryHits = (kd.memory?.hits ?? []).map(mapMemoryHit);
        }
      } catch {
        /* memory optional */
      }

      // In degraded mode the grep fallback can't rank events.jsonl, so memory
      // hits are suppressed (not merged) — but we keep the count to say so.
      const merged = degraded ? pageHits : [...pageHits, ...memoryHits];
      for (const h of merged) {
        if (h.matched.length === 0) h.matched = terms;
      }

      if (cancelled) return;
      setState({
        runState: 'ready',
        hits: merged,
        mode: degraded ? 'fallback' : 'indexer',
        memorySuppressed: degraded ? memoryHits.length : 0,
        capped: (pages.hits?.length ?? 0) >= K,
      });
      rememberQuery(committedQ, merged.length + (degraded ? memoryHits.length : 0));
    })();

    return () => {
      cancelled = true;
    };
    // resyncNonce forces a re-run after an inline reindex.
  }, [committedQ, resyncNonce, rememberQuery]);

  // ── Derived: corpus counts + filtered visible list ────────────────────────
  const counts = useMemo(() => {
    const c = { all: state.hits.length, page: 0, task: 0, memory: 0 };
    for (const h of state.hits) c[h.corpus] += 1;
    // memory pill reflects what's shown: 0 while suppressed in degraded mode.
    return c;
  }, [state.hits]);

  const visibleHits = useMemo(() => {
    return state.hits.filter((h) => {
      if (corpus !== 'all' && h.corpus !== corpus) return false;
      if (typeFilter && h.type !== typeFilter) return false;
      if (statusFilter && h.statusKind !== statusFilter) return false;
      const days = sinceFilter ? SINCE_DAYS[sinceFilter] : undefined;
      if (days !== undefined) {
        // "since" is last-write age (provenance). Only known for memory events;
        // hits without a known write date are honestly excluded, not claimed.
        if (h.sinceDays === undefined || h.sinceDays >= days) return false;
      }
      return true;
    });
  }, [state.hits, corpus, typeFilter, statusFilter, sinceFilter]);

  const corpusTotal = corpus === 'all' ? counts.all : counts[corpus];

  // Keep a valid selection whenever the visible set changes.
  useEffect(() => {
    if (visibleHits.length === 0) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((prev) => (prev && visibleHits.some((h) => h.key === prev) ? prev : (visibleHits[0]?.key ?? null)));
  }, [visibleHits]);

  const selectedIndex = visibleHits.findIndex((h) => h.key === selectedKey);
  const selectedHit = selectedIndex >= 0 ? visibleHits[selectedIndex] : undefined;

  // Refs so the window keydown handler always sees the current list/selection.
  const visibleRef = useRef(visibleHits);
  const selectedRef = useRef(selectedHit);
  visibleRef.current = visibleHits;
  selectedRef.current = selectedHit;

  // ── URL writers ───────────────────────────────────────────────────────────
  const writeParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs ? `/search?${qs}` : '/search', { scroll: false });
    },
    [router, searchParams],
  );

  const runQuery = useCallback(
    (value: string) => {
      writeParams({ q: value.trim() });
    },
    [writeParams],
  );

  const setCorpus = useCallback((c: string) => writeParams({ corpus: c === 'all' ? null : c }), [writeParams]);
  const toggleFilter = useCallback(
    (group: 'type' | 'status' | 'since', value: string) => {
      const current = searchParams.get(group);
      writeParams({ [group]: current === value ? null : value });
    },
    [searchParams, writeParams],
  );
  const clearFilters = useCallback(() => {
    writeParams({ corpus: null, type: null, status: null, since: null });
    showToast('filters cleared');
  }, [writeParams, showToast]);

  const hasActiveFilters =
    corpus !== 'all' || Boolean(typeFilter) || Boolean(statusFilter) || Boolean(sinceFilter);

  // ── Row actions ────────────────────────────────────────────────────────────
  const openHere = useCallback(
    (hit: UIHit | undefined) => {
      if (hit) router.push(hit.homeHref);
    },
    [router],
  );
  const openTree = useCallback(
    (hit: UIHit | undefined) => {
      if (hit) router.push(hit.treeHref);
    },
    [router],
  );
  const openNewTab = useCallback(
    (hit: UIHit | undefined) => {
      if (hit) {
        window.open(hit.homeHref, '_blank', 'noopener,noreferrer');
        showToast(`opened ${hit.copyValue} in a new tab · this search stays open`);
      }
    },
    [showToast],
  );
  const copyPath = useCallback(
    (hit: UIHit | undefined) => {
      if (!hit) return;
      void navigator.clipboard?.writeText(hit.copyValue).then(
        () => showToast(`copied ${hit.copyValue}`),
        () => showToast('copy failed — clipboard unavailable'),
      );
    },
    [showToast],
  );

  const focusFilters = useCallback(() => {
    const first = filtersRef.current?.querySelector<HTMLButtonElement>('.srch-fpill[data-group]:not([data-group="corpus"])');
    first?.focus();
  }, []);

  // ── Inline resync (degraded banner) ──────────────────────────────────────
  const resync = useCallback(async () => {
    setResyncing(true);
    try {
      const res = await fetch('/api/resync', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; indexed?: number };
      if (res.ok && data.ok) {
        showToast(`index rebuilt · ${data.indexed ?? 0} pages · re-ranking`);
        setResyncNonce((n) => n + 1);
      } else {
        showToast('resync failed — index still unavailable');
      }
    } catch {
      showToast('resync failed — index still unavailable');
    } finally {
      setResyncing(false);
    }
  }, [showToast]);

  // ── Selection movement ────────────────────────────────────────────────────
  const move = useCallback((delta: number) => {
    const list = visibleRef.current;
    if (list.length === 0) return;
    const cur = list.findIndex((h) => h.key === selectedRef.current?.key);
    const next = Math.min(list.length - 1, Math.max(0, (cur < 0 ? 0 : cur) + delta));
    const target = list[next];
    if (!target) return;
    setSelectedKey(target.key);
    const el = rowRefs.current.get(target.key);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  }, []);

  // ── Page-local keyboard map (⌘K / ⌘N / g-chords / ? are owned by the shell) ─
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey;
      // ⌘Enter / Ctrl+Enter — open in a NEW TAB, keep this search open. Works
      // from the query field or a focused row (the page's whole thesis).
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        openNewTab(selectedRef.current);
        return;
      }
      if (mod || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      // A focused action <button> (reached by Tab) owns Enter/o/y natively; don't
      // double-fire the row-level shortcuts on top of the button's own click.
      const active = document.activeElement;
      const inAction = !!(active instanceof HTMLElement && active.closest('.srch-actions'));

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          move(1);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          move(-1);
          break;
        case 'Enter':
          if (inAction) break;
          openHere(selectedRef.current);
          break;
        case 'o':
          if (inAction) break;
          openTree(selectedRef.current);
          break;
        case 'y':
          if (inAction) break;
          copyPath(selectedRef.current);
          break;
        case '/':
          e.preventDefault();
          queryRef.current?.focus();
          queryRef.current?.select();
          break;
        case '1':
          setCorpus('all');
          break;
        case '2':
          setCorpus('page');
          break;
        case '3':
          setCorpus('task');
          break;
        case '4':
          setCorpus('memory');
          break;
        case 'f':
          e.preventDefault();
          focusFilters();
          break;
        case 'x':
          clearFilters();
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, openHere, openTree, openNewTab, copyPath, setCorpus, clearFilters, focusFilters]);

  // Arrow navigation between the type/tier/status/since pills once `f` armed them.
  const onFiltersKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const pills = Array.from(
      filtersRef.current?.querySelectorAll<HTMLButtonElement>('.srch-fpill[data-group]:not([data-group="corpus"])') ?? [],
    );
    const i = pills.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      pills[(i + 1) % pills.length]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      pills[(i - 1 + pills.length) % pills.length]?.focus();
    } else if (e.key === 'Escape') {
      queryRef.current?.focus();
    }
  }, []);

  const degraded = state.mode === 'fallback';
  const showResults = state.runState === 'ready';

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <main className="srch">
      <span className="r-bar">Search</span>

      {/* Query block — ink "Q" label fused to a mono input. The SEARCH button is
          deliberately NOT blue: ↵ already runs the query, so the page's one blue
          moment is spent on the matched-term highlights, not a redundant button. */}
      <div className="srch-queryrow">
        <span className="srch-qlabel" aria-hidden>
          Q
        </span>
        <input
          ref={queryRef}
          id="srch-q"
          type="search"
          className="srch-input"
          value={input}
          spellCheck={false}
          autoComplete="off"
          aria-label="Search the vault"
          placeholder="search pages, tasks, memory…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              runQuery(input);
            } else if (e.key === 'Escape') {
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <button type="button" className="r-btn r-btn--ghost srch-run" onClick={() => runQuery(input)}>
          Search
        </button>
      </div>

      <p className="srch-hint r-mono">
        {state.runState === 'loading' && <>searching… k={K}</>}
        {state.runState === 'idle' && <>type a query, or press ↵ on a recent · ⌘K for the palette from anywhere</>}
        {state.runState === 'short' && (
          <>
            type at least <b>{MIN_QUERY} characters</b> — the index matches whole terms, not prefixes
          </>
        )}
        {state.runState === 'error' && <>query not evaluated — see below</>}
        {showResults && (
          <>
            <b>{state.hits.length + state.memorySuppressed} hits</b> across all corpora ·{' '}
            {degraded ? 'grep fallback · unranked, no scores' : 'ranked by term match + recency'} · k={K} max · <b>↵</b>{' '}
            opens · <b>⌘↵</b> new tab · <b>/</b> edit · <b>⌘K</b> palette
          </>
        )}
      </p>

      {/* Degraded banner — mode is never silent. */}
      {showResults && degraded && (
        <div className="srch-degraded" role="status">
          <span className="r-pill is-overdue">Fallback</span>
          <span className="srch-degraded-msg">
            Index unreachable — results below come from a plain-text grep over the vault. Ranking, snippets and memory
            hits are degraded.
          </span>
          <button type="button" className="srch-resync" onClick={resync} disabled={resyncing}>
            {resyncing ? 'Resyncing…' : 'Resync index'}
          </button>
        </div>
      )}

      {/* Filters — hidden when there's no result set to filter (idle/short/error). */}
      {(showResults || state.runState === 'loading') && (
        <div ref={filtersRef} className="srch-filters" onKeyDown={onFiltersKeyDown}>
          <div className="srch-fgroup" role="group" aria-label="Corpus">
            <span className="srch-flabel r-mono">corpus</span>
            {(['all', 'page', 'task', 'memory'] as const).map((c, i) => (
              <button
                key={c}
                type="button"
                className="srch-fpill"
                data-group="corpus"
                aria-pressed={corpus === c}
                onClick={() => setCorpus(c)}
              >
                {c === 'all' ? 'All' : c === 'page' ? 'Pages' : c === 'task' ? 'Tasks' : 'Memory'}
                <span className="cnt">{counts[c]}</span>
                <span className="key">{i + 1}</span>
              </button>
            ))}
          </div>

          <div className="srch-fgroup" role="group" aria-label="Type">
            <span className="srch-flabel r-mono">type</span>
            <span className="srch-fhint r-mono">
              press <b>f</b> to toggle these · ←/→ move · space toggles
            </span>
            {TYPE_PILLS.map((t) => (
              <button
                key={t}
                type="button"
                className="srch-fpill"
                data-group="type"
                aria-pressed={typeFilter === t}
                onClick={() => toggleFilter('type', t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="srch-fgroup" role="group" aria-label="Status">
            <span className="srch-flabel r-mono">status</span>
            {STATUS_PILLS.map((s) => (
              <button
                key={s.value}
                type="button"
                className="srch-fpill"
                data-group="status"
                aria-pressed={statusFilter === s.value}
                onClick={() => toggleFilter('status', s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="srch-fgroup" role="group" aria-label="Since (by last write)">
            <span className="srch-flabel r-mono">since</span>
            {SINCE_PILLS.map((s) => (
              <button
                key={s.value}
                type="button"
                className="srch-fpill"
                data-group="since"
                aria-pressed={sinceFilter === s.value}
                title="filters on last-write time (provenance), known for memory events"
                onClick={() => toggleFilter('since', s.value)}
              >
                {s.label}
              </button>
            ))}
            {hasActiveFilters && (
              <button type="button" className="srch-fclear" onClick={clearFilters}>
                clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Count line. */}
      {showResults && (
        <div className="srch-countline">
          <span className="r-mono">
            showing {visibleHits.length} of {corpusTotal}
            {state.capped && <span className="srch-refine"> — refine</span>} · j/k move · ↵ open · ⌘↵ new tab
          </span>
          <span className="r-mono">sort: {degraded ? 'grep order' : 'relevance'}</span>
        </div>
      )}

      {/* Overloaded / capped pressure. */}
      {showResults && state.capped && (
        <div className="srch-refinebar" role="status">
          <span>
            Hit the <b>k={K}</b> cap — you&rsquo;re seeing the top {K} of a larger set. Ranking past {K} is unreliable;
            narrow the query or add a filter.
          </span>
          <button
            type="button"
            className="srch-resync"
            onClick={() => {
              queryRef.current?.focus();
              queryRef.current?.select();
            }}
          >
            Refine query
          </button>
        </div>
      )}

      {/* ── LOADING ── */}
      {state.runState === 'loading' && (
        <ul className="srch-results srch-skel" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="srch-row srch-skelrow">
              <span className="srch-glyph srch-sk" />
              <div className="srch-body">
                <div className="srch-sk" style={{ width: '46%' }} />
                <div className="srch-sk" style={{ width: '64%', marginTop: 8, height: 9 }} />
                <div className="srch-sk" style={{ width: '82%', marginTop: 10, height: 9 }} />
              </div>
              <div className="srch-side">
                <div className="srch-sk" style={{ width: 56 }} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── READY: results ── */}
      {showResults && visibleHits.length > 0 && (
        <>
          <ul
            className={`srch-results${degraded ? ' is-degraded' : ''}`}
            role="list"
            aria-label="Search results"
          >
            {visibleHits.map((hit) => (
              <ResultRow
                key={hit.key}
                hit={hit}
                degraded={degraded}
                selected={hit.key === selectedKey}
                registerRef={(el) => {
                  if (el) rowRefs.current.set(hit.key, el);
                  else rowRefs.current.delete(hit.key);
                }}
                onSelect={() => setSelectedKey(hit.key)}
                onOpenHere={() => openHere(hit)}
                onOpenTree={() => openTree(hit)}
                onOpenNewTab={() => openNewTab(hit)}
                onCopy={() => copyPath(hit)}
              />
            ))}
          </ul>
          {degraded && state.memorySuppressed > 0 && (
            <div className="srch-suppressed r-mono">
              {state.memorySuppressed} memory hit{state.memorySuppressed === 1 ? '' : 's'} hidden — the grep fallback
              can&rsquo;t rank events.jsonl. They&rsquo;ll return when the index resyncs.
            </div>
          )}
        </>
      )}

      {/* ── EMPTY (real zero) ── */}
      {showResults && visibleHits.length === 0 && (
        <div className="r-card srch-state">
          <span className="r-bar">No hits</span>
          <div className="srch-state-title">
            nothing matches <span className="r-hl">{committedQ}</span>
            {hasActiveFilters ? ' with these filters' : ''}
          </div>
          <p>
            {state.hits.length + state.memorySuppressed > 0
              ? `${state.hits.length + state.memorySuppressed} hits matched the query, but the active filters exclude them all.`
              : 'Zero pages, tasks or memory events matched all terms.'}
          </p>
          <p>Try fewer terms, or check a filter isn&rsquo;t excluding the corpus you expect.</p>
          <div className="srch-state-actions">
            {hasActiveFilters && (
              <button type="button" className="r-btn" onClick={clearFilters}>
                Clear filters
              </button>
            )}
            <button type="button" className="r-btn" onClick={() => setCorpus('memory')}>
              Search memory only
            </button>
          </div>
          <div className="r-mono srch-state-meta">
            mode: {degraded ? 'grep fallback' : 'index'} · this is a real zero, not an index gap
          </div>
        </div>
      )}

      {/* ── ERROR ── */}
      {state.runState === 'error' && state.error && (
        <div className="r-card srch-state srch-state--error" role="alert">
          <span className="r-bar srch-bar-danger">Search unavailable</span>
          <div className="srch-state-title">the index didn&rsquo;t answer</div>
          <p>
            The search call failed{state.error.status ? ` with status ${state.error.status}` : ''}. This is a system
            failure, not an empty result — your query has <b>not</b> been evaluated.
          </p>
          <div className="srch-state-actions">
            <button type="button" className="r-btn r-btn--primary" onClick={() => setResyncNonce((n) => n + 1)}>
              Retry
            </button>
            <button type="button" className="r-btn" onClick={() => router.push('/health')}>
              Open Health → indexer
            </button>
          </div>
          <div className="r-mono srch-state-meta">
            {state.error.call} → {state.error.status || 'network error'}
          </div>
        </div>
      )}

      {/* ── SHORT QUERY ── */}
      {state.runState === 'short' && (
        <div className="r-card srch-state">
          <span className="r-bar">Query too short</span>
          <div className="srch-state-title">
            &ldquo;{committedQ}&rdquo; is under {MIN_QUERY} characters
          </div>
          <p>
            The index matches whole terms, not prefixes — a 1-character query would rank everything equally. Type at
            least {MIN_QUERY} characters, or use the palette&rsquo;s recents if you&rsquo;re navigating.
          </p>
          <div className="r-mono srch-state-meta">nothing was searched · no result set to trust or distrust</div>
        </div>
      )}

      {/* ── IDLE (arrived via rail g s, no ?q=) ── */}
      {state.runState === 'idle' && (
        <div className="srch-idle">
          <span className="r-bar">Recent searches</span>
          {recents.length > 0 ? (
            <ul className="srch-recents">
              {recents.map((r) => (
                <li key={r.q}>
                  <button type="button" onClick={() => runQuery(r.q)}>
                    <span className="rq r-mono">{r.q}</span>
                    <span className="rmeta r-mono">{r.count} hits</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="srch-coverage r-mono">
              no recent searches yet · type a query to search pages, tasks and memory events
            </p>
          )}
          <p className="srch-coverage r-mono">
            the index mirrors what Robin retrieves — pages, tasks and memory events, rebuilt on Resync
          </p>
        </div>
      )}

      {toast && (
        <div className="srch-toast r-mono" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
