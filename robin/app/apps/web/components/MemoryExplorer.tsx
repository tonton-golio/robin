'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';

/* ============================================================================
   Memory — human review queue over Robin's durable beliefs.

   Robin (the agent) WRITES every record and lifecycle event; it never reads this
   page and never self-confirms. The owner's signature — confirm / reject / archive /
   supersede — is the only thing this page adds, and it lands as an append-only
   `memory.resolved` event via POST /api/memory/resolve. If that route is absent
   the page degrades to a read-only browser with full lineage (never crashes).

   One blue moment: the Confirm action on the focused card. Red only for the
   aging flag + the destructive Reject. Everything else is ink / paper / muted.
   ========================================================================== */

interface MemorySource {
  kind: string;
  ref: string;
  quote?: string;
  captured_at?: string;
}

interface MemoryRecord {
  id: string;
  type: string;
  tier: string;
  status: string;
  confidence: string;
  scope: string;
  subject: string;
  summary: string;
  body?: string;
  tags: string[];
  links: string[];
  sources?: MemorySource[];
  source_count: number;
  seen_count: number;
  supersedes: string[];
  superseded_by?: string;
  resolution?: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

interface MemoryHit {
  memory: MemoryRecord;
  score: number;
  matched: string[];
}

type MemoryResponse =
  | { mode: 'search'; hits: MemoryHit[] }
  | { mode: 'list'; memories: MemoryRecord[] };

type ResolveMode = 'rejected' | 'archived' | 'superseded';
type StatusKey = 'tentative' | 'active' | 'superseded' | 'rejected' | 'archived';

const STATUSES: StatusKey[] = ['tentative', 'active', 'superseded', 'rejected', 'archived'];
const TYPES = [
  'preference',
  'correction',
  'decision',
  'pattern',
  'procedure',
  'project',
  'person',
  'repo',
  'task',
  'other',
];
const TIERS = ['working', 'episodic', 'semantic', 'procedural'];
const AGING_DAYS = 14;
const PAGE = 6;
// Optional GitHub owner for shorthand refs. Without it, show the reference as text.
const GH_ORG = (process.env.NEXT_PUBLIC_ROBIN_GITHUB_ORG ?? '').trim();

const ALL_STATUS_KEY = `/api/memory?status=${STATUSES.join(',')}&k=100`;

function toRecords(data: MemoryResponse | undefined): MemoryRecord[] {
  if (!data) return [];
  if (data.mode === 'search') return data.hits.map((hit) => hit.memory);
  return data.memories;
}

function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' }).toLowerCase()}`;
}
function ageDays(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}
function trimText(value: string): string {
  return value.length > 44 ? `${value.slice(0, 42)}…` : value;
}

/* Resolve a provenance ref to a navigation target, or null when it is not
   navigable (rendered as plain mono, never a fake link). Covers vault paths,
   framework/repo file paths, and GitHub repo#pr-/#run- refs. */
function refTarget(ref: string): { href: string; external: boolean } | null {
  const clean = ref.split(/\s+/)[0] ?? ref;
  const gh = clean.match(/^([a-z0-9._-]+)#(pr|run)-(\d+)$/i);
  if (gh) {
    const repo = gh[1];
    const kind = gh[2];
    const n = gh[3];
    if (repo && kind && n && /^[a-z0-9-]+$/i.test(GH_ORG)) {
      const path = kind.toLowerCase() === 'pr' ? `pull/${n}` : `actions/runs/${n}`;
      return { href: `https://github.com/${GH_ORG}/${repo}/${path}`, external: true };
    }
  }
  if (/^(inbox|brain|logs)\//.test(clean)) return { href: `/${clean}`, external: false };
  if (/^(\.claude|repos|robin|base|out)\//.test(clean)) return { href: `/file/${clean}`, external: false };
  return null;
}

function RefLink({ value }: { value: string }): React.ReactElement {
  const target = refTarget(value);
  if (!target) {
    return (
      <span className="mem-noref" title="not a navigable reference">
        {value}
      </span>
    );
  }
  if (target.external) {
    return (
      <a href={target.href} target="_blank" rel="noopener noreferrer">
        {value}
        <span className="mem-extmark" aria-hidden>
          ↗
        </span>
      </a>
    );
  }
  return <a href={target.href}>{value}</a>;
}

/* Status pill: tentative = outlined (pending signature); active = ink fill
   (the current belief); superseded / rejected / archived = muted ghost (settled
   history). None is red — a rejected memory is a closed decision, not an alarm. */
function statusPill(status: string): React.ReactElement {
  if (status === 'tentative') return <span className="r-pill is-waiting">tentative</span>;
  if (status === 'active') return <span className="r-pill is-done">active</span>;
  return <span className="r-pill mem-pill-ghost">{status}</span>;
}

/* Highlight a query hit inside subject/summary text (blue mark). */
function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/* Name where a search hit landed when it is not in subject/summary (id, tags,
   scope, …) — without a cue an id/tag match reads as a false positive. */
function matchFields(m: MemoryRecord, query: string): string[] {
  if (!query) return [];
  const q = query.toLowerCase();
  if (m.subject.toLowerCase().includes(q) || m.summary.toLowerCase().includes(q)) return [];
  const hits: string[] = [];
  if (m.id.toLowerCase().includes(q)) hits.push('id');
  if (m.tags.join(' ').toLowerCase().includes(q)) hits.push('tags');
  if (m.scope.toLowerCase().includes(q)) hits.push('scope');
  if (m.type.toLowerCase().includes(q)) hits.push('type');
  if (m.tier.toLowerCase().includes(q)) hits.push('tier');
  if ((m.body ?? '').toLowerCase().includes(q)) hits.push('body');
  if (m.links.join(' ').toLowerCase().includes(q)) hits.push('links');
  return hits;
}

/* Synthesize the agent's write history from the record's fields. The GET
   /api/memory contract does not (yet) return the per-record event stream, so we
   reconstruct what is provable from the projection: the initial save, the
   reinforcement count, and the resolution. Labeled honestly as reconstructed. */
interface TimelineEvent {
  t: 'saved' | 'seen' | 'resolved';
  at: string;
  who: 'robin' | 'human';
  detail: string;
}
function timeline(m: MemoryRecord): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { t: 'saved', at: m.created_at, who: 'robin', detail: 'promoted into recall (tentative)' },
  ];
  if (m.seen_count > 0) {
    events.push({
      t: 'seen',
      at: m.last_seen_at,
      who: 'robin',
      detail: `reinforced — referenced ${m.seen_count}× during reasoning`,
    });
  }
  if (m.resolution && m.status !== 'tentative') {
    events.push({
      t: 'resolved',
      at: m.updated_at,
      who: 'human',
      detail: `→ ${m.status} · "${m.resolution}"`,
    });
  }
  return events;
}

function matches(
  m: MemoryRecord,
  f: { q: string; status: Set<string>; type: Set<string>; tier: Set<string>; tags: Set<string> },
): boolean {
  if (f.status.size && !f.status.has(m.status)) return false;
  if (f.type.size && !f.type.has(m.type)) return false;
  if (f.tier.size && !f.tier.has(m.tier)) return false;
  if (f.tags.size && ![...f.tags].every((t) => m.tags.includes(t))) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [
      m.id,
      m.subject,
      m.summary,
      m.body ?? '',
      m.scope,
      m.type,
      m.tier,
      m.tags.join(' '),
      m.links.join(' '),
    ]
      .join(' ')
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/* Review-queue order: tentative oldest-first (longest-waiting decision on top),
   then active newest, then settled newest. Mirrors packages/memory review sort. */
function reviewSort(list: MemoryRecord[]): MemoryRecord[] {
  const rank: Record<string, number> = {
    tentative: 0,
    active: 1,
    superseded: 2,
    rejected: 2,
    archived: 2,
  };
  return [...list].sort((a, b) => {
    const ra = rank[a.status] ?? 3;
    const rb = rank[b.status] ?? 3;
    if (ra !== rb) return ra - rb;
    if (a.status === 'tentative') return a.created_at.localeCompare(b.created_at);
    return b.updated_at.localeCompare(a.updated_at);
  });
}

interface ToastState {
  msg: string;
  undo?: () => void;
}
interface UndoState {
  id: string;
  prevStatus: string;
  prevResolution?: string;
}

export function MemoryExplorer(): React.ReactElement {
  const {
    data,
    error: swrError,
    isLoading,
    mutate,
  } = useSWR<MemoryResponse>(ALL_STATUS_KEY, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const error = swrError ? (swrError as Error).message : null;

  const all = useMemo(() => toRecords(data), [data]);

  // filters
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(['tentative']));
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [tierFilter, setTierFilter] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());

  // queue state
  const [shown, setShown] = useState(PAGE);
  const [focus, setFocus] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [lineageId, setLineageId] = useState<string | null>(null);

  // dialog + toast + undo
  const [resolveCtx, setResolveCtx] = useState<{ id: string; mode: ResolveMode } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const undoRef = useRef<UndoState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const supSubjectRef = useRef<HTMLInputElement>(null);
  const supSummaryRef = useRef<HTMLTextAreaElement>(null);
  const [noteInvalid, setNoteInvalid] = useState(false);

  const byId = useCallback((id: string) => all.find((m) => m.id === id) ?? null, [all]);

  const showToast = useCallback((msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6500 : 3200);
  }, []);

  // ---- filtered + sorted visible slice ----
  const filtered = useMemo(
    () =>
      reviewSort(
        all.filter((m) =>
          matches(m, { q, status: statusFilter, type: typeFilter, tier: tierFilter, tags: tagFilter }),
        ),
      ),
    [all, q, statusFilter, typeFilter, tierFilter, tagFilter],
  );
  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown]);

  // clamp focus into the (possibly shrunk) visible list so c/x/e/s keep landing
  // on the next pending card as the queue shrinks under the cursor.
  useEffect(() => {
    setFocus((prev) => {
      if (visible.length === 0) return 0;
      return Math.max(0, Math.min(prev, visible.length - 1));
    });
  }, [visible.length]);

  // ---- counts (over the full set, all statuses) ----
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    STATUSES.forEach((s) => (c[s] = 0));
    all.forEach((m) => {
      c[m.status] = (c[m.status] ?? 0) + 1;
    });
    const aging = all.filter((m) => m.status === 'tentative' && ageDays(m.created_at) > AGING_DAYS).length;
    return { c, aging };
  }, [all]);

  const tagUniverse = useMemo(() => [...new Set(all.flatMap((m) => m.tags))].sort(), [all]);

  // ---- deep link (?id= / #?id=) → lineage view ----
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.match(/[?&]id=(mem_[A-Za-z0-9_-]+)/);
      const search = new URLSearchParams(window.location.search).get('id');
      const id = hash?.[1] ?? (search && /^mem_[A-Za-z0-9_-]+$/.test(search) ? search : null);
      setLineageId(id);
    };
    read();
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    return () => {
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
  }, []);

  const openLineage = useCallback((id: string) => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#?id=${id}`);
    }
    setOpen((prev) => new Set(prev).add(id));
    setLineageId(id);
  }, []);
  const closeLineage = useCallback(() => {
    if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname);
    setLineageId(null);
  }, []);

  // ---- filter mutators ----
  const setStatusOnly = useCallback((s: string) => {
    setStatusFilter(new Set([s]));
    setShown(PAGE);
    setFocus(0);
  }, []);
  const setStatusAll = useCallback(() => {
    setStatusFilter(new Set());
    setShown(PAGE);
    setFocus(0);
  }, []);
  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    setShown(PAGE);
  };
  const resetFilters = useCallback(() => {
    setQ('');
    if (searchRef.current) searchRef.current.value = '';
    setStatusFilter(new Set(['tentative']));
    setTypeFilter(new Set());
    setTierFilter(new Set());
    setTagFilter(new Set());
    setShown(PAGE);
    setFocus(0);
  }, []);

  const toggleOpen = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ---- lifecycle: optimistic mutate + POST /api/memory/resolve ----
  const applyLocal = useCallback(
    (id: string, patch: Partial<MemoryRecord>) => {
      void mutate(
        (current) => {
          if (!current) return current;
          if (current.mode === 'list') {
            return {
              mode: 'list',
              memories: current.memories.map((m) => (m.id === id ? { ...m, ...patch } : m)),
            };
          }
          return {
            mode: 'search',
            hits: current.hits.map((h) =>
              h.memory.id === id ? { ...h, memory: { ...h.memory, ...patch } } : h,
            ),
          };
        },
        { revalidate: false },
      );
    },
    [mutate],
  );

  const postResolve = useCallback(
    async (payload: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await fetch('/api/memory/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const info = (await res.json().catch(() => null)) as { error?: string } | null;
          showToast(`could not write — ${info?.error ?? res.status} · nothing changed on disk`);
          void mutate();
          return false;
        }
        void mutate();
        return true;
      } catch {
        showToast('resolve endpoint unreachable · read-only · nothing changed on disk');
        void mutate();
        return false;
      }
    },
    [mutate, showToast],
  );

  const doConfirm = useCallback(
    (id: string) => {
      const m = byId(id);
      if (!m || m.status !== 'tentative') return;
      const subject = m.subject;
      const prev: UndoState = { id, prevStatus: m.status, prevResolution: m.resolution };
      applyLocal(id, { status: 'active', resolution: 'Confirmed by human.' });
      void postResolve({ id, status: 'active', resolution: 'Confirmed by human.' });
      undoRef.current = prev;
      showToast(`confirmed · "${trimText(subject)}" → active`, () => {
        applyLocal(id, { status: prev.prevStatus, resolution: prev.prevResolution });
        void postResolve({ id, status: prev.prevStatus, resolution: 'undo · reverted by human' });
        undoRef.current = null;
        showToast('undone · reverted to tentative (a compensating event was appended)');
      });
    },
    [applyLocal, byId, postResolve, showToast],
  );

  const openResolve = useCallback((id: string, mode: ResolveMode) => {
    setNoteInvalid(false);
    setResolveCtx({ id, mode });
    setTimeout(() => {
      (mode === 'superseded' ? supSubjectRef.current : noteRef.current)?.focus();
    }, 0);
  }, []);
  const closeResolve = useCallback(() => setResolveCtx(null), []);

  const commitResolve = useCallback(() => {
    if (!resolveCtx) return;
    const note = noteRef.current?.value.trim() ?? '';
    if (!note) {
      setNoteInvalid(true);
      noteRef.current?.focus();
      return;
    }
    const { id, mode } = resolveCtx;
    const m = byId(id);
    if (!m) return;
    const subject = m.subject;

    if (mode === 'superseded') {
      const subj = supSubjectRef.current?.value.trim() ?? '';
      const summ = supSummaryRef.current?.value.trim() ?? '';
      if (!subj || !summ) {
        showToast('replacement subject + summary required');
        return;
      }
      applyLocal(id, { status: 'superseded', resolution: note });
      void postResolve({
        id,
        status: 'superseded',
        resolution: note,
        successor: {
          type: m.type,
          tier: m.tier,
          scope: m.scope,
          subject: subj,
          summary: summ,
          tags: m.tags,
          confidence: 'medium',
        },
      });
      // supersede mints a successor in the log — no single-level undo for it.
      undoRef.current = null;
      closeResolve();
      showToast(`superseded · "${trimText(subject)}" · successor saved tentative`);
      return;
    }

    const prev: UndoState = { id, prevStatus: m.status, prevResolution: m.resolution };
    applyLocal(id, { status: mode, resolution: note });
    void postResolve({ id, status: mode, resolution: note });
    undoRef.current = prev;
    closeResolve();
    showToast(`${mode} · "${trimText(subject)}"`, () => {
      applyLocal(id, { status: prev.prevStatus, resolution: prev.prevResolution });
      void postResolve({ id, status: prev.prevStatus, resolution: 'undo · reverted by human' });
      undoRef.current = null;
      showToast('undone · reverted (a compensating event was appended)');
    });
  }, [applyLocal, byId, closeResolve, postResolve, resolveCtx, showToast]);

  // ---- render pieces ----
  const renderChain = useCallback(
    (m: MemoryRecord): React.ReactElement => {
      const nodes: React.ReactNode[] = [];
      m.supersedes.forEach((id) => {
        const p = byId(id);
        nodes.push(
          <React.Fragment key={`pre-${id}`}>
            <div className="mem-node">
              <span className="st">superseded</span>
              <button type="button" className="linkbtn" onClick={() => openLineage(id)}>
                {id}
              </button>
              <br />
              {p?.subject ?? '(not in current projection)'}
            </div>
            <div className="mem-arrow" aria-hidden>
              →
            </div>
          </React.Fragment>,
        );
      });
      nodes.push(
        <div className="mem-node cur" key="cur">
          <span className="st">{m.status}</span>
          {m.id}
          <br />
          {m.subject}
        </div>,
      );
      if (m.superseded_by) {
        const supersededBy = m.superseded_by;
        const n = byId(supersededBy);
        nodes.push(
          <React.Fragment key={`post-${supersededBy}`}>
            <div className="mem-arrow" aria-hidden>
              →
            </div>
            <div className="mem-node">
              <span className="st">{n?.status ?? '?'}</span>
              <button type="button" className="linkbtn" onClick={() => openLineage(supersededBy)}>
                {supersededBy}
              </button>
              <br />
              {n?.subject ?? '(not in current projection)'}
            </div>
          </React.Fragment>,
        );
      }
      return <div className="mem-chain">{nodes}</div>;
    },
    [byId, openLineage],
  );

  const renderCard = useCallback(
    (m: MemoryRecord, idx: number, inLineage: boolean): React.ReactElement => {
      const isOpen = open.has(m.id);
      const isTentative = m.status === 'tentative';
      const isFocused = !inLineage && focus === idx;
      const aging = isTentative && ageDays(m.created_at) > AGING_DAYS;
      const hasChain = m.supersedes.length > 0 || !!m.superseded_by;
      const scoped = m.scope && m.scope !== 'global';
      const mf = matchFields(m, q);
      const sources = m.sources ?? [];

      return (
        <div key={m.id} className={`mem-card${isFocused ? ' focused' : ''}`} role="listitem" data-id={m.id}>
          <span className="mem-corner" aria-hidden>
            ®
          </span>
          <div className="mem-cardhead">
            {statusPill(m.status)}
            <span className="r-pill mem-pill-ghost">{m.type}</span>
            <span className="r-pill mem-pill-ghost">{m.tier}</span>
            {aging ? (
              <span className="r-pill mem-pill-aging">aging · {ageDays(m.created_at)}d unreviewed</span>
            ) : null}
            {hasChain ? (
              <button type="button" className="r-pill mem-pill-ghost" onClick={() => openLineage(m.id)}>
                lineage ↗
              </button>
            ) : null}
            {mf.length ? (
              <span className="r-pill mem-pill-match" title="query matched here, not subject/summary">
                match: {mf.join(', ')}
              </span>
            ) : null}
          </div>

          <button type="button" className="mem-subject" aria-expanded={isOpen} onClick={() => toggleOpen(m.id)}>
            {highlight(m.subject, q)}
          </button>
          <p className="mem-summary">{highlight(m.summary, q)}</p>

          <div className="mem-prov">
            {highlight(m.id, q)} · conf {m.confidence} · seen ×{m.seen_count} · {m.source_count} source
            {m.source_count === 1 ? '' : 's'} · scope {scoped ? <RefLink value={m.scope} /> : 'global'} · saved{' '}
            {shortDate(m.created_at)} · last seen {shortDate(m.last_seen_at)}
          </div>

          {isOpen ? (
            <div className="mem-bodyx">
              {m.body ? (
                <div className="mem-xsec">
                  <span className="r-bar">Body</span>
                  <p>{m.body}</p>
                </div>
              ) : null}
              {m.resolution ? (
                <div className="mem-xsec">
                  <span className="r-bar">Resolution</span>
                  <p className="mono">{m.resolution}</p>
                </div>
              ) : null}
              <div className="mem-xsec">
                <span className="r-bar">Sources · {sources.length}</span>
                {sources.length ? (
                  sources.map((s, i) => (
                    <div className="mem-srcline" key={`${s.ref}-${i}`}>
                      <span className="kind">{s.kind}</span>
                      <RefLink value={s.ref} />
                      {s.quote ? <span className="q">&ldquo;{s.quote}&rdquo;</span> : null}
                      <span className="at">{shortDate(s.captured_at)}</span>
                    </div>
                  ))
                ) : (
                  <div className="mem-srcline">
                    <span className="mem-noref">no sources recorded on this record</span>
                  </div>
                )}
              </div>
              {m.links.length ? (
                <div className="mem-xsec">
                  <span className="r-bar">Links · {m.links.length}</span>
                  {m.links.map((l, i) => (
                    <div className="mem-linkline" key={`${l}-${i}`}>
                      <RefLink value={l} />
                    </div>
                  ))}
                </div>
              ) : null}
              {hasChain ? (
                <div className="mem-xsec">
                  <span className="r-bar">Lineage</span>
                  {renderChain(m)}
                </div>
              ) : null}
              <div className="mem-xsec">
                <span className="r-bar">Event timeline · reconstructed from projection</span>
                {timeline(m).map((ev, i) => (
                  <div className="mem-evline" key={i}>
                    <span className="et">{shortDate(ev.at)}</span>
                    <span className={`ev${ev.t === 'resolved' ? ' resolved' : ''}`}>memory.{ev.t}</span>
                    <span className="ed">
                      <span className="r-actor" data-who={ev.who}>
                        {ev.who}
                      </span>{' '}
                      · {ev.detail}
                    </span>
                  </div>
                ))}
              </div>
              {m.tags.length ? (
                <div className="mem-xsec">
                  <span className="r-bar">Tags</span>
                  <p className="mono">{m.tags.map((t) => `#${t}`).join('  ')}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mem-actions">
            <button
              type="button"
              className={`r-btn mem-btn-sm ${isFocused ? 'r-btn--primary' : 'mem-confirm-quiet'}`}
              disabled={!isTentative}
              onClick={() => doConfirm(m.id)}
              title="tentative → active"
            >
              Confirm <span className="r-mono">c</span>
            </button>
            <button
              type="button"
              className="r-btn r-btn--danger mem-btn-sm"
              disabled={m.status === 'rejected'}
              onClick={() => openResolve(m.id, 'rejected')}
            >
              Reject <span className="r-mono">x</span>
            </button>
            <button
              type="button"
              className="r-btn mem-btn-sm"
              disabled={m.status === 'archived'}
              onClick={() => openResolve(m.id, 'archived')}
            >
              Archive <span className="r-mono">e</span>
            </button>
            <button
              type="button"
              className="r-btn r-btn--ink mem-btn-sm"
              disabled={m.status === 'superseded'}
              onClick={() => openResolve(m.id, 'superseded')}
            >
              Supersede… <span className="r-mono">s</span>
            </button>
            <span className="mem-hint">enter expand · l lineage</span>
          </div>
        </div>
      );
    },
    [doConfirm, focus, open, openLineage, openResolve, q, renderChain, toggleOpen],
  );

  // ---- keyboard (page-local; global g/⌘K/⌘N/? belong to the shell) ----
  const gPending = useRef(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (e.key === 'Escape') {
        if (resolveCtx) {
          closeResolve();
          return;
        }
        if (lineageId) {
          closeLineage();
          return;
        }
        if (inField) (target as HTMLElement).blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return; // shell owns ⌘K / ⌘N
      if (inField || resolveCtx) return;

      // don't double-act during a `g` jump chord the shell is consuming
      if (gPending.current) {
        gPending.current = false;
        return;
      }
      if (e.key === 'g') {
        gPending.current = true;
        setTimeout(() => (gPending.current = false), 900);
        return;
      }

      // let a focused real control own Enter/Space
      const ae = document.activeElement as HTMLElement | null;
      const onControl = ae && (ae.tagName === 'BUTTON' || (ae.tagName === 'A' && ae.hasAttribute('href')));
      if (onControl && (e.key === 'Enter' || e.key === ' ')) return;

      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      const currentList = lineageId ? (byId(lineageId) ? [byId(lineageId) as MemoryRecord] : []) : visible;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        if (lineageId) return;
        setFocus((prev) => Math.min(currentList.length - 1, prev + 1));
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        if (lineageId) return;
        setFocus((prev) => Math.max(0, prev - 1));
        return;
      }

      if (['Enter', 'o', 'l', 'c', 'x', 'e', 's'].includes(e.key)) {
        const m = lineageId ? byId(lineageId) : currentList[focus] ?? null;
        if (!m) {
          showToast('press j to focus a card first');
          return;
        }
        if (e.key === 'Enter' || e.key === 'o') {
          toggleOpen(m.id);
          return;
        }
        if (e.key === 'l') {
          if (m.supersedes.length || m.superseded_by) openLineage(m.id);
          else showToast('no lineage on this memory');
          return;
        }
        if (e.key === 'c') {
          if (m.status === 'tentative') doConfirm(m.id);
          else showToast('only tentative memories can be confirmed');
          return;
        }
        if (e.key === 'x') {
          if (m.status !== 'rejected') openResolve(m.id, 'rejected');
          else showToast('already rejected');
          return;
        }
        if (e.key === 'e') {
          if (m.status !== 'archived') openResolve(m.id, 'archived');
          else showToast('already archived');
          return;
        }
        if (e.key === 's') {
          if (m.status !== 'superseded') openResolve(m.id, 'superseded');
          else showToast('already superseded');
          return;
        }
      }

      if (/^[0-5]$/.test(e.key)) {
        if (lineageId) closeLineage();
        if (e.key === '0') {
          setStatusAll();
        } else {
          const key = STATUSES[Number(e.key) - 1];
          if (key) setStatusOnly(key);
        }
        return;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [
    byId,
    closeLineage,
    closeResolve,
    doConfirm,
    focus,
    lineageId,
    openLineage,
    openResolve,
    resolveCtx,
    setStatusAll,
    setStatusOnly,
    showToast,
    toggleOpen,
    visible,
  ]);

  // ---- derived view flags ----
  const zero = filtered.length === 0 && all.length > 0;
  const reviewOnly =
    statusFilter.size === 1 &&
    statusFilter.has('tentative') &&
    !q &&
    !typeFilter.size &&
    !tierFilter.size &&
    !tagFilter.size;

  const describeFilters = () => {
    const bits: string[] = [];
    if (q) bits.push(`q="${q}"`);
    if (statusFilter.size) bits.push(`status=${[...statusFilter].join(',')}`);
    if (typeFilter.size) bits.push(`type=${[...typeFilter].join(',')}`);
    if (tierFilter.size) bits.push(`tier=${[...tierFilter].join(',')}`);
    if (tagFilter.size) bits.push(`tags=${[...tagFilter].join(',')}`);
    return `GET /api/memory?${bits.join('&') || '(none)'}`;
  };

  const lineageRecord = lineageId ? byId(lineageId) : null;

  // ============================ RENDER ============================
  return (
    <div className="mem-page">
      <div className="mem-head">
        <span className="r-bar">Memory — review queue</span>
        <span className="mem-tagline">what robin believes, pending your signature</span>
      </div>
      <h1 className="mem-title">durable recall, curated by hand</h1>

      {lineageId ? (
        // ---- LINEAGE DEEP-LINK VIEW ----
        <div className="mem-lineage-view">
          <button type="button" className="mem-backlink" onClick={closeLineage}>
            ← back to queue (esc)
          </button>
          {lineageRecord ? (
            <div className="mem-lineage-box">
              <span className="r-bar">Lineage — ?id={lineageRecord.id}</span>
              <div style={{ margin: '14px 0 16px' }}>{renderChain(lineageRecord)}</div>
              {renderCard(lineageRecord, 0, true)}
            </div>
          ) : (
            <div className="mem-state">
              <span className="r-bar">Not found</span>
              <h2>no memory with that id</h2>
              <p className="mono">{lineageId}</p>
              <p>It may live on a different vault, or the id is stale.</p>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ---- COUNT STRIP ---- */}
          <div className="mem-counts" role="group" aria-label="Memory counts">
            <button
              type="button"
              className={`mem-count hot${statusFilter.size === 1 && statusFilter.has('tentative') ? ' sel' : ''}`}
              onClick={() => setStatusOnly('tentative')}
            >
              <b>{counts.c.tentative}</b>
              <span>tentative — need review</span>
              {counts.aging ? (
                <span className="mem-aging-note">
                  {counts.aging} aging &gt;{AGING_DAYS}d
                </span>
              ) : null}
            </button>
            {(['active', 'superseded', 'rejected', 'archived'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`mem-count${statusFilter.size === 1 && statusFilter.has(s) ? ' sel' : ''}`}
                onClick={() => setStatusOnly(s)}
              >
                <b>{counts.c[s]}</b>
                <span>{s}</span>
              </button>
            ))}
            <button
              type="button"
              className={`mem-count${statusFilter.size === 0 ? ' sel' : ''}`}
              onClick={setStatusAll}
            >
              <b>{all.length}</b>
              <span>total in log</span>
            </button>
          </div>

          {/* ---- FILTER BAR ---- */}
          <div className="mem-filters">
            <div className="mem-frow">
              <input
                ref={searchRef}
                className="mem-search"
                type="text"
                placeholder="/ search subject, summary, body, tags, scope, id…"
                aria-label="Search memories"
                autoComplete="off"
                defaultValue={q}
                onChange={(e) => {
                  setQ(e.target.value.trim());
                  setShown(PAGE);
                }}
              />
              <span className="mem-result-meta">
                {filtered.length} of {all.length}
                <button type="button" className="mem-fpill" onClick={resetFilters}>
                  reset
                </button>
              </span>
            </div>
            <div className="mem-frow">
              <span className="mem-fgroup">
                <span className="mem-lbl">Status</span>
                {STATUSES.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    className={`mem-fpill${statusFilter.has(s) ? ' on' : ''}`}
                    onClick={() => toggleSet(setStatusFilter, s)}
                  >
                    {s}
                    <span className="k">{i + 1}</span>
                  </button>
                ))}
              </span>
            </div>
            <div className="mem-frow">
              <span className="mem-fgroup">
                <span className="mem-lbl">Type</span>
                {TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`mem-fpill${typeFilter.has(t) ? ' on' : ''}`}
                    onClick={() => toggleSet(setTypeFilter, t)}
                  >
                    {t}
                  </button>
                ))}
              </span>
              <span className="mem-fgroup" style={{ marginLeft: 14 }}>
                <span className="mem-lbl">Tier</span>
                {TIERS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`mem-fpill${tierFilter.has(t) ? ' on' : ''}`}
                    onClick={() => toggleSet(setTierFilter, t)}
                  >
                    {t}
                  </button>
                ))}
              </span>
            </div>
            {tagUniverse.length ? (
              <div className="mem-frow">
                <span className="mem-fgroup">
                  <span className="mem-lbl">Tags</span>
                  {tagUniverse.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`mem-fpill${tagFilter.has(t) ? ' on' : ''}`}
                      onClick={() => toggleSet(setTagFilter, t)}
                    >
                      {t}
                    </button>
                  ))}
                </span>
              </div>
            ) : null}
          </div>

          {/* ---- STATES + QUEUE ---- */}
          {isLoading && all.length === 0 ? (
            <div className="mem-skeleton" aria-busy>
              <div className="mem-sk">
                <span className="m">{ALL_STATUS_KEY} …</span>
              </div>
              <div className="mem-sk" />
              <div className="mem-sk" />
            </div>
          ) : error ? (
            <div className="mem-state error">
              <span className="r-bar">Memory API unreachable</span>
              <h2>the projection didn&rsquo;t load</h2>
              <p className="mono">GET /api/memory → {error}</p>
              <p>Nothing was written. The event log is append-only — whatever exists is safe on disk.</p>
              <div className="row">
                <button type="button" className="r-btn r-btn--primary" onClick={() => void mutate()}>
                  Retry
                </button>
                <a className="r-btn r-btn--ghost" href="/health">
                  Open Health
                </a>
              </div>
            </div>
          ) : all.length === 0 ? (
            <div className="mem-state">
              <span className="r-bar">No memories yet</span>
              <h2>robin hasn&rsquo;t promoted anything into recall</h2>
              <p>
                Memories are written by the agent when a session produces durable knowledge — run{' '}
                <span className="r-hl-ink r-mono">/learn</span> after a substantial session, or let{' '}
                <span className="r-mono">/remsleep</span> consolidate the day. New memories arrive as{' '}
                <b>tentative</b> and wait here for your confirm/reject.
              </p>
            </div>
          ) : zero && reviewOnly ? (
            <div className="mem-state">
              <span className="r-bar">Queue clear</span>
              <h2>nothing waiting for your signature</h2>
              <p>
                Every tentative memory has been confirmed, rejected, superseded, or archived. New ones arrive
                when the agent runs <span className="r-hl-ink r-mono">/learn</span>, or when{' '}
                <span className="r-mono">/remsleep</span> consolidates the day.
              </p>
              <div className="row">
                <button type="button" className="r-btn r-btn--ghost" onClick={() => setStatusOnly('active')}>
                  Show active memories
                </button>
                <button type="button" className="r-btn r-btn--ghost" onClick={setStatusAll}>
                  Show all in log
                </button>
              </div>
            </div>
          ) : zero ? (
            <div className="mem-state">
              <span className="r-bar">0 of {all.length}</span>
              <h2>nothing matches these filters</h2>
              <p className="mono">{describeFilters()}</p>
              <div className="row">
                <button type="button" className="r-btn r-btn--primary" onClick={resetFilters}>
                  Reset filters
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mem-queue" role="list">
                {visible.map((m, i) => renderCard(m, i, false))}
              </div>
              {filtered.length > shown ? (
                <div style={{ marginTop: 20 }}>
                  <button type="button" className="r-btn" onClick={() => setShown((s) => s + PAGE)}>
                    Load more
                  </button>
                  <span className="r-mono" style={{ marginLeft: 12 }}>
                    showing {visible.length} of {filtered.length} — no silent cap
                  </span>
                </div>
              ) : null}
            </>
          )}

          <p className="mem-tagline" style={{ marginTop: 44 }}>
            reject freely — the log forgets nothing, it just stops believing
          </p>
        </>
      )}

      {/* ---- RESOLUTION DIALOG ---- */}
      {resolveCtx ? (
        <div
          className="mem-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeResolve();
          }}
        >
          <div className="mem-sheet" role="dialog" aria-modal="true" aria-labelledby="mem-resolve-title">
            <div className="mem-sheet-head">
              <span id="mem-resolve-title">
                {resolveCtx.mode === 'rejected'
                  ? 'Reject memory'
                  : resolveCtx.mode === 'archived'
                    ? 'Archive memory'
                    : 'Supersede with note'}
              </span>
              <button type="button" onClick={closeResolve}>
                esc ✕
              </button>
            </div>
            <div className="mem-sheet-body">
              <div className="mem-sheet-target">
                {(() => {
                  const m = byId(resolveCtx.id);
                  return m ? `${m.id} · "${m.subject}"` : resolveCtx.id;
                })()}
              </div>
              {resolveCtx.mode === 'superseded' ? (
                <>
                  <label htmlFor="mem-sup-subject">Replacement subject</label>
                  <input
                    ref={supSubjectRef}
                    id="mem-sup-subject"
                    type="text"
                    placeholder="what should robin believe instead?"
                  />
                  <label htmlFor="mem-sup-summary">Replacement summary</label>
                  <textarea
                    ref={supSummaryRef}
                    id="mem-sup-summary"
                    rows={2}
                    placeholder="the corrected claim, one or two sentences"
                  />
                </>
              ) : null}
              <label htmlFor="mem-resolve-note">
                Resolution note <span className="lc">(required — lands in the event log)</span>
              </label>
              <textarea
                ref={noteRef}
                id="mem-resolve-note"
                rows={2}
                className={noteInvalid ? 'invalid' : undefined}
                placeholder="why — future-you and the agent both read this"
                onChange={() => noteInvalid && setNoteInvalid(false)}
              />
            </div>
            <div className="mem-sheet-foot">
              <button type="button" className="r-btn r-btn--ghost" onClick={closeResolve}>
                Cancel
              </button>
              <button
                type="button"
                className={`r-btn ${
                  resolveCtx.mode === 'rejected'
                    ? 'r-btn--danger'
                    : resolveCtx.mode === 'superseded'
                      ? 'r-btn--ink'
                      : ''
                }`}
                onClick={commitResolve}
              >
                {resolveCtx.mode === 'rejected'
                  ? 'Reject'
                  : resolveCtx.mode === 'archived'
                    ? 'Archive'
                    : 'Supersede'}
              </button>
            </div>
            <div className="mem-sheet-api">
              {resolveCtx.mode === 'superseded'
                ? 'POST /api/memory/resolve {id, status:"superseded", resolution, successor} → mints successor (tentative) + appends memory.resolved'
                : `POST /api/memory/resolve {id, status:"${resolveCtx.mode}", resolution} → appends memory.resolved to events.jsonl`}
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- TOAST ---- */}
      {toast ? (
        <div className="mem-toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo ? (
            <button
              type="button"
              className="mem-toast-undo"
              onClick={() => {
                const fn = toast.undo;
                setToast(null);
                if (toastTimer.current) clearTimeout(toastTimer.current);
                fn?.();
              }}
            >
              undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
