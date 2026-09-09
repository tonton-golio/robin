'use client';

import { useEffect, useState } from 'react';
import type { CalendarTodayEvent } from '@/lib/calendar';
import type { TaskItem } from '@/lib/tasks';
import { classificationTone, normalizeStatus } from '@/lib/task-display';

const START_HOUR = 8;
const END_HOUR = 20;
const SPAN = END_HOUR - START_HOUR;

/** Tone -> Quiet Slate token (accent tones share `--blue`; health tones keep
 *  their semantic tokens so both themes resolve). */
const TONE_VAR: Record<string, string> = {
  cyan: 'var(--blue)',
  green: 'var(--good)',
  violet: 'var(--blue)',
  amber: 'var(--blue)',
  rust: 'var(--red)',
  neutral: 'var(--muted)',
};

/** Local fractional hour of a Date (e.g. 14.5 for 14:30). */
function fracHour(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}
function clampPct(h: number): number {
  return Math.max(0, Math.min(100, ((h - START_HOUR) / SPAN) * 100));
}

export function DayRail({
  events,
  tasks,
  available,
  dropArmed,
}: {
  events: CalendarTodayEvent[];
  tasks: TaskItem[]; // tasks anchored to today (planned today, or scheduled & due today)
  available: boolean;
  dropArmed: boolean;
}) {
  // Live "now" — re-rendered each minute so the needle sweeps the day.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const timed = events.filter((e) => !e.allDay);
  const allDay = events.filter((e) => e.allDay);
  const nowPct = now ? clampPct(fracHour(now)) : null;
  const hours: number[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h += 2) hours.push(h);

  return (
    <div
      data-drop-rail
      data-rail-start={START_HOUR}
      data-rail-end={END_HOUR}
      className={[
        'relative rounded-[var(--radius-lg)] border bg-[var(--card)] px-3 pb-3 pt-2 transition-colors',
        dropArmed ? 'border-[var(--blue)]' : 'border-[var(--line)]',
      ].join(' ')}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          Today · {available ? 'synced' : 'no snapshot'}
        </span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          calendar: today only
        </span>
      </div>

      {allDay.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {allDay.map((e) => (
            <span
              key={e.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--card-2)] px-2 py-0.5 text-[11px] text-[var(--ink)] shadow-[var(--offset-sm)]"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: TONE_VAR[classificationTone(e.classification)] }}
              />
              {e.title}
            </span>
          ))}
        </div>
      ) : null}

      {/* hour track */}
      <div className="relative mt-1 h-[58px] select-none">
        {/* hour ticks + labels */}
        {hours.map((h) => (
          <div
            key={h}
            className="absolute top-0 bottom-0 border-l border-[var(--hairline)]"
            style={{ left: `${clampPct(h)}%` }}
          >
            <span className="absolute -top-0.5 left-1 font-mono text-[11px] tabular-nums text-[var(--muted)]">
              {String(h).padStart(2, '0')}
            </span>
          </div>
        ))}
        {/* baseline */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-[var(--line)]" />

        {/* past shading */}
        {nowPct !== null ? (
          <div
            className="absolute inset-y-0 left-0 bg-[var(--paper)]/40"
            style={{ width: `${nowPct}%` }}
            aria-hidden
          />
        ) : null}

        {/* timed events */}
        {timed.map((e) => {
          const s = new Date(e.start);
          const en = new Date(e.end);
          if (Number.isNaN(s.getTime())) return null;
          const left = clampPct(fracHour(s));
          const right = clampPct(Number.isNaN(en.getTime()) ? fracHour(s) + 1 : fracHour(en));
          const tone = TONE_VAR[classificationTone(e.classification)];
          return (
            <div
              key={e.id}
              className="absolute bottom-2 top-3 overflow-hidden rounded-[var(--radius-sm)] border px-1.5 py-1 text-[11px] leading-tight"
              style={{
                left: `${left}%`,
                width: `${Math.max(right - left, 6)}%`,
                borderColor: `color-mix(in srgb, ${tone} 45%, transparent)`,
                background: `color-mix(in srgb, ${tone} 12%, var(--card-2))`,
                color: 'var(--ink)',
              }}
              title={`${e.title} · ${s.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
            >
              <span className="block truncate">{e.title}</span>
            </div>
          );
        })}

        {/* ghost task blocks (planned today, or scheduled & due today) */}
        {tasks.map((t) => {
          const planned = t.planned ? new Date(t.planned) : null;
          const h = planned && !Number.isNaN(planned.getTime()) ? fracHour(planned) : END_HOUR - 0.5;
          const past = nowPct !== null && clampPct(h) < nowPct;
          const done = normalizeStatus(t.state) === 'done';
          const color = past && !done ? 'var(--red)' : 'var(--blue)';
          return (
            <div
              key={t.path}
              className="absolute bottom-2 top-3 flex items-center overflow-hidden rounded-[var(--radius-sm)] border border-dashed px-1.5 text-[11px] leading-tight"
              style={{
                left: `${clampPct(h)}%`,
                width: '11%',
                borderColor: `color-mix(in srgb, ${color} 60%, transparent)`,
                background: `color-mix(in srgb, ${color} 8%, transparent)`,
                color,
              }}
              title={`${t.title}${planned ? ' · planned ' + planned.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ' · due today'}`}
            >
              <span className="block truncate">{t.title}</span>
            </div>
          );
        })}

        {/* now-needle */}
        {nowPct !== null ? (
          <div
            className="standup-now-needle absolute -top-1 bottom-0 z-10 w-px"
            style={{ left: `${nowPct}%`, background: 'var(--blue)' }}
            aria-hidden
          >
            <span className="absolute -top-2 left-1 whitespace-nowrap font-mono text-[11px] tabular-nums text-[var(--blue)]">
              {now!.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
