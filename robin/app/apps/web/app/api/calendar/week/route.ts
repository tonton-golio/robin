/**
 * GET /api/calendar/week
 *
 * Serves the 7-day window for the Standup week grid. Always returns a usable
 * skeleton (so the grid lays out even with no snapshot); `available` reflects
 * whether any real event data backed it.
 */

import { NextResponse } from 'next/server';
import { loadCalendarWeek } from '@/lib/calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const week = await loadCalendarWeek();
  const available = week.days.some((d) => d.events.length > 0);
  return NextResponse.json({ ...week, available });
}
