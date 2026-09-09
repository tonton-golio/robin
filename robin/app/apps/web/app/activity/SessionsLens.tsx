'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRovingRows } from './useRovingRows';
import type { ActivityData, SessionDay } from './model';

function fullDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

function monthName(key: string): string {
  const d = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function DayRow({ day }: { day: SessionDay }): React.ReactElement {
  return (
    <a
      className="act-srow"
      data-activity-row
      data-page-href={day.href}
      href={day.href}
      tabIndex={0}
      role="option"
      aria-selected={false}
    >
      <span className="act-srow-date r-mono">{fullDate(day.date)}</span>
      <span className="act-srow-pill">{day.sessions} sess</span>
      <span className="act-srow-title">
        {day.title}
        {day.outcomes.length > 0 ? (
          <span className="act-srow-sm r-mono">{day.outcomes[0]}</span>
        ) : null}
      </span>
      <span className="act-srow-open r-mono">open ↗</span>
    </a>
  );
}

export function SessionsLens({
  data,
  active,
  today,
}: {
  data: ActivityData;
  active: boolean;
  today: string;
}): React.ReactElement {
  const router = useRouter();
  const currentMonth = today.slice(0, 7);
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set([currentMonth]));

  const onRowKey = useCallback(
    (key: string, row: HTMLElement) => {
      if (key === 'o' || key === 'Enter') {
        const href = row.dataset.pageHref;
        if (href) router.push(href);
      }
    },
    [router],
  );
  const { containerRef } = useRovingRows({ onRowKey, active });

  const todayDay = data.sessions.find((s) => s.date === today);
  const rest = data.sessions.filter((s) => s.date !== today);

  const byMonth = useMemo(() => {
    const map = new Map<string, SessionDay[]>();
    for (const s of rest) {
      const k = monthKeyOf(s.date);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rest]);

  if (data.sessions.length === 0 && !data.liveSession) {
    return (
      <section aria-label="Sessions">
        <div className="act-statebox">
          <span className="r-bar">Sessions</span>
          <div className="act-statebox-t">no session captures yet</div>
          <p>Daily working-session logs written by the capture hooks appear here.</p>
        </div>
      </section>
    );
  }

  function toggleMonth(k: string) {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <section aria-label="Sessions" ref={containerRef}>
      {/* Today: pinned + expanded — this lens's single blue moment (stepped date). */}
      <div className="act-todayblock">
        <div className="act-todayhead">
          <h2 className="r-stepped act-todaystepped">
            <span>{fullDate(today).toLowerCase()}</span>
          </h2>
          <div className="act-todayhead-right">
            <span className="r-mono">
              {todayDay ? `${todayDay.sessions} sessions` : 'no sessions yet'}
            </span>
            <a className="r-btn r-btn--ink" href="/capture" title="Launches the /eod-signoff flow">
              EOD sign-off
            </a>
          </div>
        </div>

        {data.liveSession ? (
          <div className="act-srow act-srow--live" role="status">
            <span className="act-srow-date r-mono">
              <span className="act-liveblink" aria-hidden /> live
            </span>
            <span className="act-srow-pill act-srow-pill--live">Recording</span>
            <span className="act-srow-title">
              capture in progress
              <span className="act-srow-sm r-mono">
                {data.liveSession.pid ? `pid ${data.liveSession.pid}` : ''}
                {data.liveSession.log ? ` · ${data.liveSession.log}` : ''}
              </span>
            </span>
          </div>
        ) : null}

        {todayDay ? (
          <>
            <DayRow day={todayDay} />
            {todayDay.outcomes.length > 1 ? (
              <ul className="act-today-outcomes">
                {todayDay.outcomes.slice(1).map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="act-today-empty r-mono">no session captured today yet</p>
        )}
      </div>

      {byMonth.map(([month, daysInMonth]) => {
        const isOpen = openMonths.has(month);
        const totalSessions = daysInMonth.reduce((n, d) => n + d.sessions, 0);
        return (
          <div className="act-sessionsmonth" key={month}>
            <button
              type="button"
              className="act-monthbar"
              aria-expanded={isOpen}
              onClick={() => toggleMonth(month)}
            >
              <span className="r-bar">{monthName(month)}</span>
              <span className="act-monthbar-m r-mono">
                {daysInMonth.length} days · {totalSessions} sessions
              </span>
              <span className="act-monthbar-chev r-mono">{isOpen ? '▾' : '▸'} </span>
            </button>
            {isOpen ? (
              <div className="act-monthbody">
                {daysInMonth.map((d) => (
                  <DayRow day={d} key={d.date} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
