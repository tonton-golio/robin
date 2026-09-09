import fs from 'fs/promises';
import { vaultPath } from '@/lib/vault';

export type CalendarClassification =
  | 'stakeholder'
  | 'team'
  | 'external'
  | 'interview'
  | 'focus'
  | 'other';

export interface CalendarTodayEvent {
  id: string;
  title: string;
  start: string; // ISO-8601
  end: string; // ISO-8601
  allDay?: boolean;
  location?: string;
  attendees?: string[];
  classification?: CalendarClassification;
}

export interface CalendarToday {
  date: string; // YYYY-MM-DD
  timezone?: string;
  generatedAt?: string; // ISO-8601
  events: CalendarTodayEvent[];
}

const CALENDAR_FILE = ['.robin', 'calendar', 'today.json'];
const CALENDAR_WEEK_FILE = ['.robin', 'calendar', 'week.json'];

/** A single day's events within a week snapshot. */
export interface CalendarDay {
  date: string; // YYYY-MM-DD
  events: CalendarTodayEvent[];
}

export interface CalendarWeek {
  start: string; // YYYY-MM-DD (first day shown)
  timezone?: string;
  generatedAt?: string; // ISO-8601
  days: CalendarDay[];
}

function localDateString(d: Date): string {
  // YYYY-MM-DD in the server's local time.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Read the calendar snapshot written by /check-calendar.
 * Returns null when the file is missing, unparseable, or stale
 * (its `date` is not today).
 */
export async function loadCalendarToday(): Promise<CalendarToday | null> {
  try {
    const raw = await fs.readFile(vaultPath(...CALENDAR_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CalendarToday>;
    if (!parsed || !Array.isArray(parsed.events) || typeof parsed.date !== 'string') {
      return null;
    }
    if (parsed.date !== localDateString(new Date())) {
      return null; // stale snapshot from a previous day
    }
    return {
      date: parsed.date,
      timezone: parsed.timezone,
      generatedAt: parsed.generatedAt,
      events: parsed.events,
    };
  } catch {
    return null;
  }
}

/**
 * Load a 7-day calendar window for the Standup week grid.
 *
 * Prefers a richer `week.json` snapshot (written by /check-calendar) when it is
 * still relevant (covers today or a future day). Falls back to wrapping the
 * single-day `today.json` so the grid always has *something* honest to show, and
 * finally to an empty 7-day skeleton starting today. The skeleton lets the UI
 * lay out the week (and place tasks by due/planned) even with no event data.
 */
export async function loadCalendarWeek(): Promise<CalendarWeek> {
  const todayStr = localDateString(new Date());

  // 1. Rich week snapshot, if present and not entirely in the past.
  try {
    const raw = await fs.readFile(vaultPath(...CALENDAR_WEEK_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CalendarWeek>;
    if (parsed && Array.isArray(parsed.days) && parsed.days.length > 0) {
      const days = parsed.days
        .filter((d): d is CalendarDay => !!d && typeof d.date === 'string' && Array.isArray(d.events))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (days.length > 0 && days[days.length - 1]!.date >= todayStr) {
        return {
          start: days[0]!.date,
          timezone: parsed.timezone,
          generatedAt: parsed.generatedAt,
          days,
        };
      }
    }
  } catch {
    // fall through
  }

  // 2. Fall back to the single-day snapshot folded into a skeleton week.
  const today = await loadCalendarToday();
  const skeleton = skeletonWeek(todayStr);
  if (today) {
    const slot = skeleton.find((d) => d.date === today.date);
    if (slot) slot.events = today.events;
    else skeleton.unshift({ date: today.date, events: today.events });
    return { start: skeleton[0]!.date, timezone: today.timezone, generatedAt: today.generatedAt, days: skeleton };
  }
  return { start: skeleton[0]!.date, days: skeleton };
}

/** Seven consecutive empty days starting at `startDate` (YYYY-MM-DD). */
function skeletonWeek(startDate: string): CalendarDay[] {
  const [y, m, d] = startDate.split('-').map(Number);
  const days: CalendarDay[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(y!, m! - 1, d! + i));
    const iso = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    days.push({ date: iso, events: [] });
  }
  return days;
}
