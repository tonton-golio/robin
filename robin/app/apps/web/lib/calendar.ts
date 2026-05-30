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
