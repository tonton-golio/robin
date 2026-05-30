import { NextResponse } from 'next/server';
import { loadCalendarToday } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const cal = await loadCalendarToday();
  if (!cal) {
    return NextResponse.json({ events: null, available: false });
  }
  return NextResponse.json({
    events: cal.events,
    available: true,
    date: cal.date,
    generatedAt: cal.generatedAt,
  });
}
