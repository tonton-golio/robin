'use client';

import type { CalendarDay } from '@/lib/calendar';
import type { TaskItem } from '@/lib/tasks';
import { classificationTone, localDateString, taskDateKey, byTriage, normalizeStatus } from '@/lib/task-display';
import { StatusGlyph } from './StatusGlyph';

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

function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString(undefined, {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

export function WeekStrip({
  days,
  tasks,
  dropDay,
}: {
  days: CalendarDay[];
  tasks: TaskItem[];
  dropDay: string | null; // currently drag-hovered day, for highlight
}) {
  const today = localDateString(new Date());
  // Bucket tasks by their anchored calendar date once.
  const byDay = new Map<string, TaskItem[]>();
  for (const t of tasks) {
    if (normalizeStatus(t.state) === 'done' || normalizeStatus(t.state) === 'archived') continue;
    const key = taskDateKey(t);
    if (!key) continue;
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(t);
  }

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map((day) => {
        const isToday = day.date === today;
        const dayTasks = (byDay.get(day.date) ?? []).slice().sort(byTriage);
        const [, , dd] = day.date.split('-');
        return (
          <div
            key={day.date}
            data-drop-day={day.date}
            className={[
              'min-h-[112px] rounded-[var(--radius-lg)] border bg-[var(--card)] p-1.5 transition-colors',
              dropDay === day.date
                ? 'border-[var(--blue)] bg-[color-mix(in_srgb,var(--blue)_10%,var(--card))]'
                : isToday
                  ? 'border-[var(--blue)]/40'
                  : 'border-[var(--line)]',
            ].join(' ')}
          >
            <div className="mb-1 flex items-baseline justify-between">
              <span
                className={[
                  'font-mono text-[11px] font-semibold uppercase tracking-[0.06em]',
                  isToday ? 'text-[var(--blue)]' : 'text-[var(--muted)]',
                ].join(' ')}
              >
                {weekday(day.date)}
              </span>
              <span
                className={
                  isToday
                    ? 'text-[13px] font-semibold tabular-nums text-[var(--ink)]'
                    : 'text-[13px] tabular-nums text-[var(--muted)]'
                }
              >
                {dd}
              </span>
            </div>

            <div className="space-y-1">
              {day.events.slice(0, 3).map((e) => (
                <div key={e.id} className="flex items-center gap-1 truncate text-[11px] text-[var(--ink)]" title={e.title}>
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: TONE_VAR[classificationTone(e.classification)] }}
                  />
                  <span className="truncate">{e.title}</span>
                </div>
              ))}
              {day.events.length > 3 ? (
                <div className="text-[11px] text-[var(--muted)]">+{day.events.length - 3} more</div>
              ) : null}

              {dayTasks.map((t) => (
                <div
                  key={t.path}
                  className="flex items-center gap-1 truncate rounded-[var(--radius-sm)] border border-dashed border-[var(--blue)]/40 bg-[var(--accent-wash)] px-1 py-0.5 text-[11px] text-[var(--ink)]"
                  title={t.title}
                >
                  <StatusGlyph status={t.state} size={10} />
                  <span className="truncate">{t.title}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
