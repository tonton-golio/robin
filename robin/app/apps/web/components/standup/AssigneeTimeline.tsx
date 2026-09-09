'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { TaskItem } from '@/lib/tasks';
import {
  STATUS_COLUMN_TONE,
  statusColumnFromStatus,
  normalizeStatus,
  type Tone,
} from '@/lib/task-display';

/**
 * Per-assignee timeline (gantt) for the Standup board.
 *
 * One swimlane row per owner; every task is a bar spanning its planned window
 * [start → end]. Reuses DayRail's bar-positioning idea (absolute left%+width%)
 * but generalizes the axis from hours-of-one-day to days-across-a-range. No
 * charting lib — hand-positioned divs styled with the Quiet Slate tokens,
 * matching DayRail/WeekStrip.
 *
 * Date model (see robin:start / robin:end / robin:due):
 *   end   = robin:end ?? robin:due ?? robin:start        (bar terminus)
 *   start = robin:start ?? robin:created ?? end          (bar origin)
 * `due` is the hard deadline; `end` is the visible schedule terminus. Tasks
 * with no date at all are listed in a footer rather than drawn.
 */

/** Tone -> Quiet Slate token. Accent tones share `--blue`; health tones keep
 *  their semantic tokens so both themes resolve. */
const TONE_VAR: Record<Tone, string> = {
  cyan: 'var(--blue)',
  green: 'var(--good)',
  violet: 'var(--blue)',
  amber: 'var(--blue)',
  rust: 'var(--red)',
  neutral: 'var(--muted)',
};

const DAY = 86_400_000;
const ROW_H = 24; // px per stacked sub-row within a lane
const MIN_BAR_PCT = 1.2;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse a date-only (YYYY-MM-DD) or ISO datetime to UTC-midnight ms, or null. */
function toDayMs(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  return Number.isNaN(d.getTime())
    ? null
    : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function fmtDay(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

interface Bar {
  task: TaskItem;
  startMs: number;
  endMs: number;
}

function barFor(t: TaskItem): Bar | null {
  const end = toDayMs(t.end) ?? toDayMs(t.due) ?? toDayMs(t.start);
  const start = toDayMs(t.start) ?? toDayMs(t.created) ?? end;
  if (start === null && end === null) return null;
  let s = start ?? end!;
  const e = end ?? start!;
  if (s > e) s = e; // clamp an inverted range to a point
  return { task: t, startMs: s, endMs: e };
}

function occupiedEndMs(bar: Bar, minVisualMs: number): number {
  return Math.max(bar.endMs + DAY, bar.startMs + minVisualMs);
}

/** Greedy interval-pack a lane's bars into non-overlapping visual sub-rows. */
function packLane(bars: Bar[], minVisualMs: number): Bar[][] {
  const sorted = [...bars].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const rows: Bar[][] = [];
  for (const bar of sorted) {
    const row = rows.find((r) => bar.startMs >= occupiedEndMs(r[r.length - 1]!, minVisualMs));
    if (row) row.push(bar);
    else rows.push([bar]);
  }
  return rows;
}

function ownerLabel(owner: string | undefined): string {
  return owner && owner !== 'unassigned' ? owner : 'Unassigned';
}

export function AssigneeTimeline({ tasks }: { tasks: TaskItem[] }) {
  const model = useMemo(() => {
    const bars: Bar[] = [];
    const undated: TaskItem[] = [];
    for (const t of tasks) {
      if (normalizeStatus(t.state) === 'archived') continue;
      const b = barFor(t);
      if (b) bars.push(b);
      else undated.push(t);
    }

    // Lanes: one per owner. Assigned owners alphabetical, "Unassigned" last.
    const byOwner = new Map<string, Bar[]>();
    for (const b of bars) {
      const key = ownerLabel(b.task.owner);
      (byOwner.get(key) ?? byOwner.set(key, []).get(key)!).push(b);
    }
    const lanes = [...byOwner.entries()].sort((a, b) => {
      if (a[0] === 'Unassigned') return 1;
      if (b[0] === 'Unassigned') return -1;
      return a[0].localeCompare(b[0]);
    });

    // Window: data extent, always including today, padded a day each side.
    const now = new Date();
    const tMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const all = bars.flatMap((b) => [b.startMs, b.endMs]);
    const dataMin = all.length ? Math.min(...all) : tMs;
    const dataMax = all.length ? Math.max(...all) : tMs + 21 * DAY;
    const winStart = Math.min(dataMin, tMs) - DAY;
    const winEnd = Math.max(dataMax, tMs + 7 * DAY) + DAY;
    const span = Math.max(winEnd - winStart, DAY);
    const minVisualMs = (span * MIN_BAR_PCT) / 100;

    // Weekly gridlines on Mondays within the window.
    const ticks: number[] = [];
    const first = new Date(winStart);
    const dow = (first.getUTCDay() + 6) % 7; // 0 = Monday
    let cur = winStart + (dow === 0 ? 0 : (7 - dow) * DAY);
    while (cur <= winEnd) {
      ticks.push(cur);
      cur += 7 * DAY;
    }

    return { lanes, undated, winStart, span, minVisualMs, tMs, ticks };
  }, [tasks]);

  const { lanes, undated, winStart, span, minVisualMs, tMs, ticks } = model;
  const pct = (ms: number) => ((ms - winStart) / span) * 100;
  const todayPct = pct(tMs);

  const GUTTER = '7.5rem';

  if (lanes.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] bg-[var(--card)] px-3 py-6 text-center text-[12px] italic text-[var(--muted)] shadow-[var(--offset-sm)]">
        no scheduled tasks — give tasks a start/end date to see them here
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] bg-[var(--card)] px-3 pb-3 pt-2 shadow-[var(--offset-sm)]">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          Timeline · by assignee
        </span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
          {fmtDay(winStart)} – {fmtDay(winStart + span)}
        </span>
      </div>

      {/* Axis header — week labels */}
      <div className="grid" style={{ gridTemplateColumns: `${GUTTER} 1fr` }}>
        <div />
        <div className="relative h-4">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11px] text-[var(--muted)]"
              style={{ left: `${pct(t)}%` }}
            >
              {fmtDay(t)}
            </span>
          ))}
        </div>
      </div>

      {/* Lanes */}
      <div className="grid items-stretch" style={{ gridTemplateColumns: `${GUTTER} 1fr` }}>
        {lanes.map(([owner, bars]) => {
          const rows = packLane(bars, minVisualMs);
          const laneH = rows.length * ROW_H + 6;
          return (
            <LaneRow
              key={owner}
              owner={owner}
              count={bars.length}
              laneH={laneH}
              ticks={ticks}
              pct={pct}
              todayPct={todayPct}
              rows={rows}
            />
          );
        })}
      </div>

      {/* Footer — unscheduled */}
      {undated.length > 0 ? (
        <p className="mt-2 border-t border-[var(--hairline)] pt-1.5 font-mono text-[11px] text-[var(--muted)]">
          {undated.length} task{undated.length === 1 ? '' : 's'} unscheduled (no start/end/due)
        </p>
      ) : null}
    </div>
  );
}

function LaneRow({
  owner,
  count,
  laneH,
  ticks,
  pct,
  todayPct,
  rows,
}: {
  owner: string;
  count: number;
  laneH: number;
  ticks: number[];
  pct: (ms: number) => number;
  todayPct: number;
  rows: Bar[][];
}) {
  return (
    <>
      <div
        className="flex items-center gap-1.5 border-t border-[var(--hairline)] pr-2 text-[11px] text-[var(--ink)]"
        style={{ minHeight: laneH }}
      >
        <span className="truncate" title={owner}>
          {owner}
        </span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--muted)]">{count}</span>
      </div>
      <div className="relative border-t border-[var(--hairline)]" style={{ minHeight: laneH }}>
        {/* weekly gridlines */}
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute inset-y-0 border-l border-[var(--hairline)]"
            style={{ left: `${pct(t)}%` }}
            aria-hidden
          />
        ))}
        {/* today needle */}
        {todayPct >= 0 && todayPct <= 100 ? (
          <div
            className="absolute inset-y-0 z-10 w-px"
            style={{ left: `${todayPct}%`, background: 'var(--blue)' }}
            aria-hidden
          />
        ) : null}
        {/* bars */}
        {rows.map((row, ri) =>
          row.map((bar) => {
            const tone = TONE_VAR[STATUS_COLUMN_TONE[statusColumnFromStatus(bar.task.state)]];
            const left = pct(bar.startMs);
            const width = Math.max(
              Math.min(100 - left, Math.max(pct(bar.endMs + DAY) - left, MIN_BAR_PCT)),
              0.4,
            );
            const done = normalizeStatus(bar.task.state) === 'done';
            return (
              <Link
                key={bar.task.path}
                href={bar.task.href}
                title={`${bar.task.title} · ${fmtDay(bar.startMs)} → ${fmtDay(bar.endMs)}${
                  bar.task.priority ? ' · ' + bar.task.priority : ''
                }`}
                className="absolute flex items-center overflow-hidden rounded-[var(--radius-sm)] border px-1.5 text-[11px] leading-tight hover:brightness-125"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  top: ri * ROW_H + 3,
                  height: ROW_H - 6,
                  borderColor: `color-mix(in srgb, ${tone} 50%, transparent)`,
                  // Done bars recede by colour, not by opacity: fading the bar
                  // took its 11px label down with it (spec section 10a).
                  background: done
                    ? 'color-mix(in srgb, var(--muted) 16%, var(--card-2))'
                    : `color-mix(in srgb, ${tone} 16%, var(--card-2))`,
                  color: done ? 'var(--muted)' : 'var(--ink)',
                  opacity: 1,
                }}
              >
                <span className="block truncate">{bar.task.title}</span>
              </Link>
            );
          }),
        )}
      </div>
    </>
  );
}
