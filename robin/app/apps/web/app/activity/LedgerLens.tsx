'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRovingRows } from './useRovingRows';
import { LedgerRow } from './LedgerRow';
import {
  BURST_HEAD,
  BURST_THRESHOLD,
  facetCounts,
  filterEvents,
  gapBetween,
  groupIntoDays,
  localDay,
  monthKey,
  type ActivityData,
  type ArtifactKind,
  type LedgerEvent,
  type LedgerFilters,
  type LedgerKind,
  type LedgerOrigin,
} from './model';

const KIND_VALUES: LedgerKind[] = ['created', 'edited', 'reverted', 'deleted', 'ingest'];
const ARTIFACT_VALUES: ArtifactKind[] = ['page', 'task', 'deck'];

function dayLabel(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00`);
  const base = Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  return date === today ? `${base} — today` : base;
}

function timeRange(start: string, end: string): string {
  const fmt = (ts: string) => {
    const d = new Date(ts);
    return Number.isNaN(d.getTime())
      ? ts.slice(11, 16)
      : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };
  const a = fmt(start);
  const b = fmt(end);
  return a === b ? a : `${a}–${b}`;
}

function monthName(key: string): string {
  const d = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

interface LedgerLensProps {
  data: ActivityData;
  active: boolean;
  watermark: string | null;
  onMarkSeen: () => void;
  filters: LedgerFilters;
  setParam: (updates: Record<string, string | null>) => void;
}

export function LedgerLens({
  data,
  active,
  watermark,
  onMarkSeen,
  filters,
  setParam,
}: LedgerLensProps): React.ReactElement {
  const router = useRouter();
  const today = localDay(new Date().toISOString());

  const [diffOpen, setDiffOpen] = useState<Set<string>>(new Set());
  const [undoOpen, setUndoOpen] = useState<Set<string>>(new Set());
  const [expandedBursts, setExpandedBursts] = useState<Set<string>>(new Set());
  const [monthWindow, setMonthWindow] = useState(2);

  const toggleDiff = useCallback((id: string) => {
    setDiffOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleUndo = useCallback((id: string) => {
    setUndoOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onRowKey = useCallback(
    (key: string, row: HTMLElement) => {
      const id = row.dataset.eventId;
      if (!id) return;
      if (key === 'x') toggleDiff(id);
      else if (key === 'u') toggleUndo(id);
      else if (key === 'o' || key === 'Enter') {
        const link = row.querySelector<HTMLAnchorElement>('a[data-act="open"]');
        if (link) router.push(link.getAttribute('href') || '#');
      }
    },
    [router, toggleDiff, toggleUndo],
  );

  const { containerRef } = useRovingRows({ onRowKey, active });

  const isUnseen = useCallback(
    (e: LedgerEvent) => e.origin === 'robin' && (!watermark || e.ts > watermark),
    [watermark],
  );

  // ── since-you-last-looked stats (over the whole stream, not filtered) ──
  const since = useMemo(() => {
    const unseen = data.edits.filter(isUnseen);
    const writes = unseen.filter((e) => e.kind !== 'ingest').length;
    const ingest = unseen.filter((e) => e.kind === 'ingest').length;
    const sessions = groupIntoDays(unseen).reduce((n, d) => n + d.sessions.length, 0);
    return { writes, ingest, sessions, total: unseen.length };
  }, [data.edits, isUnseen]);

  // ── scope + filters ──
  const scoped = filters.path ? data.edits.filter((e) => e.path === filters.path) : data.edits;
  const facets = useMemo(() => facetCounts(scoped), [scoped]);
  const anyFilter = Boolean(filters.origin || filters.kind || filters.artifact || filters.path);

  const filtered = useMemo(
    () =>
      filterEvents(scoped, {
        origin: filters.origin,
        kind: filters.kind,
        artifact: filters.artifact,
      }),
    [scoped, filters.origin, filters.kind, filters.artifact],
  );

  // ── month windowing ──
  const months = useMemo(() => {
    const set = new Set(filtered.map((e) => monthKey(e.ts)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [filtered]);
  const visibleMonthSet = useMemo(
    () => new Set(months.slice(0, monthWindow)),
    [months, monthWindow],
  );
  const visibleEvents = useMemo(
    () => filtered.filter((e) => visibleMonthSet.has(monthKey(e.ts))),
    [filtered, visibleMonthSet],
  );
  const nextMonth = months[monthWindow];
  const nextMonthCount = nextMonth
    ? filtered.filter((e) => monthKey(e.ts) === nextMonth).length
    : 0;

  const days = useMemo(() => groupIntoDays(visibleEvents), [visibleEvents]);

  function toggleFilter(group: 'origin' | 'kind' | 'artifact', value: string) {
    const current = filters[group];
    setParam({ [group]: current === value ? null : value });
  }

  function expandAllInSession(ids: string[], collapse: boolean) {
    setDiffOpen((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (collapse) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const dateRange =
    visibleEvents.length > 0
      ? `${dayLabel(localDay(visibleEvents[0]!.ts), today)} → ${dayLabel(
          localDay(visibleEvents[visibleEvents.length - 1]!.ts),
          today,
        )}`
      : '';

  // ── empty (healthy) state ──
  if (!data.error && data.edits.length === 0) {
    return (
      <section aria-label="Ledger">
        <div className="act-statebox">
          <span className="r-bar">Ledger</span>
          <div className="act-statebox-t">the ledger is healthy — just empty</div>
          <p>No edit, ingest, or revert events have been recorded yet.</p>
          <p className="r-mono">
            0 lines skipped · this is a real zero, not a read failure.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Ledger">
      {/* the page's ONE blue moment */}
      {since.total > 0 ? (
        <div className="act-since">
          <span className="act-since-reg">®</span>
          <div className="act-since-t">
            since you last looked: {since.writes} writes · {since.sessions} robin sessions ·{' '}
            {since.ingest} ingest
          </div>
          <div className="act-since-m r-mono">
            watermark: {watermark ? watermark.replace('T', ' ').slice(0, 16) : 'never'} · everything
            below the blue edge is new to you
          </div>
          <div className="act-since-actions">
            <button type="button" className="act-since-btn" onClick={onMarkSeen}>
              Mark seen — move watermark to now
            </button>
            <button
              type="button"
              className="act-since-btn"
              onClick={() => {
                const el = containerRef.current?.querySelector<HTMLElement>('.act-unseen');
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el?.focus();
              }}
            >
              Jump to first unseen
            </button>
          </div>
        </div>
      ) : (
        <div className="act-since act-since--seen">
          <span className="act-since-m r-mono">you are caught up — nothing new since last look</span>
        </div>
      )}

      {/* ?path= scope chip */}
      {filters.path ? (
        <div className="act-scopechip">
          <b>Scoped</b>
          <span className="r-mono">
            ?path={filters.path} · {scoped.length} events shown
          </span>
          <button type="button" className="act-scopechip-x" onClick={() => setParam({ path: null })}>
            clear scope ×
          </button>
        </div>
      ) : null}

      {/* filters */}
      <div className="act-filters">
        <div className="act-fgroup" role="group" aria-label="Origin">
          <span className="act-flabel r-mono">origin</span>
          {(['human', 'robin'] as LedgerOrigin[]).map((v) => (
            <button
              key={v}
              type="button"
              className="act-fpill"
              aria-pressed={filters.origin === v}
              onClick={() => toggleFilter('origin', v)}
            >
              {v}
              <span className="act-fpill-cnt">{facets.origin[v] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="act-fgroup" role="group" aria-label="Kind">
          <span className="act-flabel r-mono">kind</span>
          {KIND_VALUES.map((v) => (
            <button
              key={v}
              type="button"
              className="act-fpill"
              aria-pressed={filters.kind === v}
              onClick={() => toggleFilter('kind', v)}
            >
              {v}
              <span className="act-fpill-cnt">{facets.kind[v] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="act-fgroup" role="group" aria-label="Artifact">
          <span className="act-flabel r-mono">artifact</span>
          {ARTIFACT_VALUES.map((v) => (
            <button
              key={v}
              type="button"
              className="act-fpill"
              aria-pressed={filters.artifact === v}
              onClick={() => toggleFilter('artifact', v)}
            >
              {v}
              <span className="act-fpill-cnt">{facets.artifact[v] ?? 0}</span>
            </button>
          ))}
          {anyFilter ? (
            <button
              type="button"
              className="act-fclear"
              onClick={() => setParam({ origin: null, kind: null, artifact: null })}
            >
              clear filters
            </button>
          ) : null}
        </div>
      </div>

      <div className="act-countline">
        <span className="r-mono">
          {visibleEvents.length} events{dateRange ? ` · ${dateRange}` : ''}
        </span>
        <span className="r-mono">order: newest first</span>
      </div>

      {/* ledger body */}
      <div className="act-ledgerbody" ref={containerRef} role="listbox" aria-label="Edit ledger">
        {days.length === 0 ? (
          <div className="act-statebox act-statebox--flat">
            <p>No events match the current filters.</p>
          </div>
        ) : null}

        {days.map((day, dayIdx) => {
          const prevDay = days[dayIdx - 1];
          const gap = !anyFilter && prevDay ? gapBetween(prevDay.date, day.date) : null;
          return (
            <React.Fragment key={day.date}>
              {gap ? (
                <div className="act-gaprow r-mono">
                  — no writes {gap.days} day{gap.days === 1 ? '' : 's'} ({gap.fromDate} … {gap.toDate}) —
                </div>
              ) : null}

              <div className="act-daybar">
                <span className="r-bar">{dayLabel(day.date, today)}</span>
                <span className="r-mono act-daybar-m">
                  {day.eventCount} events · {day.sessions.length} session
                  {day.sessions.length === 1 ? '' : 's'}
                </span>
              </div>

              {day.sessions.map((session, sIdx) => {
                const ids = session.events.map((e) => e.id);
                const allDiffOpen = ids.every((id) => diffOpen.has(id));
                const isBurst = session.events.length >= BURST_THRESHOLD;
                const burstExpanded = expandedBursts.has(session.key);
                const head = isBurst && !burstExpanded ? session.events.slice(0, BURST_HEAD) : session.events;
                const tail = isBurst && !burstExpanded ? session.events.slice(BURST_HEAD) : [];
                return (
                  <div className="act-session" key={session.key}>
                    <div className="act-shead">
                      <span className="act-stime r-mono">{timeRange(session.start, session.end)}</span>
                      <span className={`act-origin act-origin--${session.origin}`}>
                        {session.origin}
                      </span>
                      <span className="act-stool r-mono">
                        {session.tool ? `${session.tool} · ` : ''}
                        {session.events.length} write{session.events.length === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        className="act-expall"
                        onClick={() => expandAllInSession(ids, allDiffOpen)}
                      >
                        {allDiffOpen ? 'Collapse all' : 'Expand all diffs'}
                      </button>
                      <span className="act-sn r-mono">session #{day.sessions.length - sIdx}</span>
                    </div>

                    {head.map((event) => (
                      <LedgerRow
                        key={event.id}
                        event={event}
                        unseen={isUnseen(event)}
                        diffOpen={diffOpen.has(event.id)}
                        undoOpen={undoOpen.has(event.id)}
                        onToggleDiff={toggleDiff}
                        onToggleUndo={toggleUndo}
                        onReverted={() => router.refresh()}
                      />
                    ))}

                    {tail.length > 0 ? (
                      <button
                        type="button"
                        className="act-burstexpand"
                        aria-expanded={false}
                        onClick={() =>
                          setExpandedBursts((prev) => new Set(prev).add(session.key))
                        }
                      >
                        <span className="act-burstexpand-n">+{tail.length}</span>
                        more writes in this burst — expand
                      </button>
                    ) : null}

                    {isBurst && burstExpanded ? (
                      <button
                        type="button"
                        className="act-burstexpand"
                        aria-expanded
                        onClick={() =>
                          setExpandedBursts((prev) => {
                            const next = new Set(prev);
                            next.delete(session.key);
                            return next;
                          })
                        }
                      >
                        Collapse burst
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}

        {nextMonth ? (
          <div className="act-loadmore">
            <button
              type="button"
              className="r-btn r-btn--ghost"
              onClick={() => setMonthWindow((n) => n + 1)}
            >
              Load {monthName(nextMonth)} ({nextMonthCount} events)
            </button>
            <span className="r-mono">month-windowed · no request parses all of history</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
