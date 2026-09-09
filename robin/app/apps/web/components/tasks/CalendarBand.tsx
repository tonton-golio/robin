'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarToday, CalendarWeek, CalendarTodayEvent } from '@/lib/calendar';
import type { TaskItem } from '@/lib/tasks';
import { normalizeStatus, dueInfo, localDateString } from '@/lib/task-display';
import { isLeaf, isActiveStatus } from '@/lib/task-hierarchy';
import { relativeTime, type CalMode } from './task-view';

const DAY_START = 7;
const DAY_END = 18;
const DAY_SPAN = DAY_END - DAY_START;

function fracHour(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}
function clampPct(h: number): number {
  return Math.max(0, Math.min(100, ((h - DAY_START) / DAY_SPAN) * 100));
}

/** generatedAt honesty: red when the snapshot is older than ~30 min. */
function genLine(generatedAt: string | undefined): { text: string; stale: boolean } {
  if (!generatedAt) return { text: 'no calendar snapshot on disk', stale: true };
  const t = new Date(generatedAt).getTime();
  const stale = Number.isNaN(t) || Date.now() - t > 30 * 60000;
  const clock = Number.isNaN(t)
    ? ''
    : ` · snapshot ${new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  return { text: `calendar generated ${relativeTime(generatedAt)}${clock}`, stale };
}


export function CalendarBand({
  mode,
  onMode,
  today,
  week,
  tasks,
  ownerFilter,
  onOwnerToggle,
  onReschedule,
}: {
  mode: CalMode;
  onMode: (m: CalMode) => void;
  today: CalendarToday | null;
  week: CalendarWeek;
  tasks: TaskItem[];
  ownerFilter: string;
  onOwnerToggle: (owner: string) => void;
  onReschedule: (path: string, patch: { start?: string; end?: string; planned?: string }) => void;
}) {
  const gen = genLine(today?.generatedAt ?? week.generatedAt);

  return (
    <div className="tk-calband" id="calBand">
      <div className="tk-calhead">
        <div className="tk-calmodes" role="group" aria-label="Calendar mode">
          <button
            className="tk-calmode"
            aria-pressed={mode === 'day'}
            onClick={() => onMode('day')}
          >
            Day rail
          </button>
          <button
            className="tk-calmode"
            aria-pressed={mode === 'week'}
            onClick={() => onMode('week')}
          >
            Week strip
          </button>
          <button
            className="tk-calmode"
            aria-pressed={mode === 'timeline'}
            onClick={() => onMode('timeline')}
          >
            Assignee timeline
          </button>
        </div>
        <span className={`tk-calgen${gen.stale ? ' stale' : ''}`}>{gen.text}</span>
      </div>
      <div className="tk-callegend">
        <span>
          <i className="tk-sw ev" />scheduled event (solid — real, on the calendar)
        </span>
        <span>
          <i className="tk-sw gh" />planned window (dashed ghost — task start→end, not a meeting)
        </span>
      </div>
      <div className="tk-calbody">
        {mode === 'day' ? (
          <DayRail today={today} tasks={tasks} onReschedule={onReschedule} />
        ) : mode === 'week' ? (
          <WeekStrip week={week} tasks={tasks} />
        ) : (
          <AssigneeTimeline
            week={week}
            tasks={tasks}
            ownerFilter={ownerFilter}
            onOwnerToggle={onOwnerToggle}
            onReschedule={onReschedule}
          />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── DAY RAIL ─────────────────────────── */

function DayRail({
  today,
  tasks,
  onReschedule,
}: {
  today: CalendarToday | null;
  tasks: TaskItem[];
  onReschedule: (path: string, patch: { planned?: string }) => void;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const todayKey = localDateString(new Date());
  const events = (today?.events ?? []).filter((e) => !e.allDay);
  // Ghost windows: leaves planned today (or due today), positioned by planned instant.
  const ghosts = tasks.filter((t) => {
    if (!isLeaf(t)) return false;
    if (t.planned) return localDateString(new Date(t.planned)) === todayKey;
    if (t.due && /^\d{4}-\d{2}-\d{2}/.test(t.due)) return t.due.slice(0, 10) === todayKey;
    return false;
  });

  const hours: number[] = [];
  for (let h = DAY_START; h <= DAY_END; h += 1) hours.push(h);
  const nowPct = now ? clampPct(fracHour(now)) : null;

  return (
    <div className="tk-dayrail">
      <div className="tk-hours">
        {hours.map((h) => (
          <span key={h}>{String(h).padStart(2, '0')}</span>
        ))}
      </div>
      <div className="tk-track">
        {nowPct !== null ? (
          <div
            className="tk-now"
            style={{ left: `${nowPct}%` }}
            title={`now · ${now!.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
          />
        ) : null}
        {events.map((e: CalendarTodayEvent) => {
          const s = new Date(e.start);
          const en = new Date(e.end);
          if (Number.isNaN(s.getTime())) return null;
          const left = clampPct(fracHour(s));
          const right = clampPct(Number.isNaN(en.getTime()) ? fracHour(s) + 1 : fracHour(en));
          return (
            <div
              key={e.id}
              className="tk-cbar ev"
              style={{ left: `${left}%`, width: `${Math.max(right - left, 8)}%` }}
              title={`${e.title} · ${s.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
            >
              {e.title}
            </div>
          );
        })}
        {ghosts.map((t) => {
          const planned = t.planned ? new Date(t.planned) : null;
          const h = planned && !Number.isNaN(planned.getTime()) ? fracHour(planned) : DAY_END - 1;
          return (
            <button
              key={t.path}
              className="tk-cbar gh"
              style={{ left: `${clampPct(h)}%`, width: '18%' }}
              title={`${t.title} — planned window (drag to reschedule)`}
              onClick={() => {
                // Nudge the planned instant one hour later (keyboard-free reschedule).
                const base = planned ?? new Date();
                base.setHours(base.getHours() + 1);
                onReschedule(t.path, { planned: base.toISOString() });
              }}
            >
              {t.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── WEEK STRIP ─────────────────────────── */

function WeekStrip({ week, tasks }: { week: CalendarWeek; tasks: TaskItem[] }) {
  const todayKey = localDateString(new Date());
  const ghostsByDay = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const t of tasks) {
      if (!isLeaf(t)) continue;
      const key = t.planned
        ? localDateString(new Date(t.planned))
        : t.due && /^\d{4}-\d{2}-\d{2}/.test(t.due)
          ? t.due.slice(0, 10)
          : null;
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  return (
    <div className="tk-weekstrip">
      {week.days.map((d) => {
        const date = new Date(`${d.date}T00:00:00`);
        const label = Number.isNaN(date.getTime())
          ? d.date
          : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }).toLowerCase();
        const isToday = d.date === todayKey;
        const ghosts = ghostsByDay.get(d.date) ?? [];
        return (
          <div key={d.date} className={`tk-wcol${isToday ? ' today' : ''}`}>
            <div className="tk-wd">
              {label}
              {isToday ? ' ·today' : ''}
            </div>
            {d.events
              .filter((e) => !e.allDay)
              .map((e) => (
                <div key={e.id} className="tk-wev ev" title={e.title}>
                  {e.title}
                </div>
              ))}
            {ghosts.map((t) => (
              <div key={t.path} className="tk-wev gh" title={`${t.title} — planned`}>
                {t.title}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────── ASSIGNEE TIMELINE ─────────────────────── */

function AssigneeTimeline({
  week,
  tasks,
  ownerFilter,
  onOwnerToggle,
  onReschedule,
}: {
  week: CalendarWeek;
  tasks: TaskItem[];
  ownerFilter: string;
  onOwnerToggle: (owner: string) => void;
  onReschedule: (path: string, patch: { start?: string; end?: string }) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const startDate = new Date(`${week.start}T00:00:00`);
  const dayMs = 86400000;
  const startMs = startDate.getTime();
  const winDays = 7;

  // Derive lanes from the vault instead of carrying an adopter-specific roster.
  const owners = useMemo(() => {
    const present = new Set<string>();
    for (const t of tasks) {
      if (!isLeaf(t)) continue;
      const o = (t.owner ?? '').toLowerCase();
      if (o && o !== 'unassigned') present.add(o.split(/[ @]/)[0]!);
    }
    return [...present].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  function barGeom(t: TaskItem): { left: number; width: number } | null {
    const s = t.start ? new Date(`${t.start}T00:00:00`).getTime() : null;
    const eRaw = t.end ?? t.due;
    const e = eRaw && /^\d{4}-\d{2}-\d{2}/.test(eRaw) ? new Date(`${eRaw.slice(0, 10)}T00:00:00`).getTime() : null;
    const from = s ?? e;
    const to = e ?? s;
    if (from === null || to === null) return null;
    const leftDay = (from - startMs) / dayMs;
    const rightDay = (to - startMs) / dayMs + 1; // inclusive end day
    const left = Math.max(0, Math.min(winDays, leftDay));
    const right = Math.max(0, Math.min(winDays, rightDay));
    if (right <= 0 || left >= winDays) return null;
    return { left: (left / winDays) * 100, width: (Math.max(right - left, 0.5) / winDays) * 100 };
  }

  const dayHeaders: string[] = [];
  for (let i = 0; i < winDays; i += 1) {
    const d = new Date(startMs + i * dayMs);
    dayHeaders.push(String(d.getDate()));
  }

  function handleDrag(t: TaskItem, mode: 'move' | 'resize', downX: number, geom: { left: number; width: number }) {
    const trackW = trackRef.current?.clientWidth ?? 1;
    function pxToDays(dx: number): number {
      return Math.round((dx / trackW) * winDays);
    }
    function onUp(e: PointerEvent) {
      document.removeEventListener('pointerup', onUp);
      const deltaDays = pxToDays(e.clientX - downX);
      if (deltaDays === 0) return;
      const sMs = t.start ? new Date(`${t.start}T00:00:00`).getTime() : startMs + Math.round((geom.left / 100) * winDays) * dayMs;
      const eRaw = t.end ?? t.due;
      const eMs = eRaw ? new Date(`${eRaw.slice(0, 10)}T00:00:00`).getTime() : sMs;
      if (mode === 'move') {
        const ns = localDateString(new Date(sMs + deltaDays * dayMs));
        const ne = localDateString(new Date(eMs + deltaDays * dayMs));
        onReschedule(t.path, { start: ns, end: ne });
      } else {
        const ne = localDateString(new Date(Math.max(sMs, eMs + deltaDays * dayMs)));
        onReschedule(t.path, { end: ne });
      }
    }
    document.addEventListener('pointerup', onUp);
  }

  return (
    <div className="tk-timeline">
      <div className="tk-tlhead">
        <span />
        <div className="tk-tldays">
          {dayHeaders.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
      </div>
      {owners.map((owner) => {
        const lane = tasks.filter(
          (t) => isLeaf(t) && (t.owner ?? '').toLowerCase().startsWith(owner),
        );
        return (
          <div key={owner} className="tk-tlane">
            <button
              className="tk-who"
              aria-pressed={ownerFilter === owner}
              onClick={() => onOwnerToggle(owner)}
            >
              {owner}
            </button>
            <div className="tk-tltrack" ref={owners[0] === owner ? trackRef : undefined}>
              {lane.map((t) => {
                const g = barGeom(t);
                if (!g) return null;
                const d = dueInfo(t.due).days;
                const overdue = isActiveStatus(t.state) && d !== null && d < 0;
                const done = normalizeStatus(t.state) === 'done';
                return (
                  <div
                    key={t.path}
                    className={`tk-tlbar${overdue ? ' od' : ''}${done ? ' done' : ''}`}
                    style={{ left: `${g.left}%`, width: `${g.width}%` }}
                    title={`${t.title}${overdue ? ' · overdue' : ''} — drag to reschedule`}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).classList.contains('tk-rz')) return;
                      handleDrag(t, 'move', e.clientX, g);
                    }}
                  >
                    <span className="tk-tlbar-t">{t.title}</span>
                    <span
                      className="tk-rz"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        handleDrag(t, 'resize', e.clientX, g);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
