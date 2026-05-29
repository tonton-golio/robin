'use client';

/**
 * CalendarMatcher.tsx (OPTIONAL)
 *
 * Fetches today's calendar from /api/calendar/events (backed by the
 * .robin/calendar/today.json snapshot that /check-calendar or /launch writes)
 * and suggests a meeting slug + attendees based on time overlap with the
 * recording.
 *
 * If no snapshot is present, or the fetch fails, the component renders a
 * neutral placeholder — it never throws or blocks the recorder.
 */

import React, { useEffect, useState } from 'react';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO-8601
  end: string;   // ISO-8601
  attendees?: string[];
}

interface CalendarMatcherProps {
  recordingStartedAt?: Date | null;
  onSuggestion?: (suggestion: { slug: string; attendees: string[] }) => void;
}

export function CalendarMatcher({ recordingStartedAt, onSuggestion }: CalendarMatcherProps) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Only attempt to fetch if a recording has started (so we know the time context)
    // and we have something to query.
    setLoading(true);

    fetch('/api/calendar/events?window=today')
      .then(async res => {
        if (!res.ok) return null;
        const data = await res.json() as { events?: CalendarEvent[] };
        return data.events ?? null;
      })
      .catch(() => null)
      .then(evts => {
        setEvents(evts);
        setLoading(false);

        if (evts && evts.length > 0 && recordingStartedAt) {
          // Find the event closest in time to when recording started
          const target = recordingStartedAt.getTime();
          const closest = evts.reduce<CalendarEvent | null>((best, evt) => {
            const evtStart = new Date(evt.start).getTime();
            if (!best) return evt;
            const bestStart = new Date(best.start).getTime();
            return Math.abs(evtStart - target) < Math.abs(bestStart - target) ? evt : best;
          }, null);

          if (closest) {
            const slug = closest.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .slice(0, 60);
            const attendees = closest.attendees ?? [];
            onSuggestion?.({ slug, attendees });
          }
        }
      });
  }, [recordingStartedAt, onSuggestion]);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground italic">
        Checking calendar…
      </div>
    );
  }

  // No events fetched (calendar not available or API not wired up yet)
  if (!events) {
    return (
      <div className="text-xs text-muted-foreground italic">
        Calendar suggestions unavailable — run <span className="not-italic font-mono text-muted-foreground">/check-calendar</span> to sync today&rsquo;s events.
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">No calendar events today.</div>
    );
  }

  const now = new Date();
  const upcoming = events.filter(e => new Date(e.end) > now);
  const past = events.filter(e => new Date(e.end) <= now);

  return (
    <div className="flex flex-col gap-2">
      {upcoming.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-semibold mb-1">Now / upcoming</p>
          <ul className="space-y-1">
            {upcoming.slice(0, 3).map(evt => (
              <CalendarEventRow
                key={evt.id}
                event={evt}
                onSuggestion={onSuggestion}
              />
            ))}
          </ul>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-semibold mb-1">Previous</p>
          <ul className="space-y-1">
            {past.slice(-2).map(evt => (
              <CalendarEventRow
                key={evt.id}
                event={evt}
                onSuggestion={onSuggestion}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CalendarEventRow({
  event,
  onSuggestion,
}: {
  event: CalendarEvent;
  onSuggestion?: CalendarMatcherProps['onSuggestion'];
}) {
  const start = new Date(event.start);
  const timeStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleApply = () => {
    const slug = event.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    onSuggestion?.({ slug, attendees: event.attendees ?? [] });
  };

  return (
    <li className="flex items-start gap-2">
      <span className="text-xs text-muted-foreground font-mono tabular-nums w-16 flex-shrink-0 whitespace-nowrap pt-0.5">
        {timeStr}
      </span>
      <button
        onClick={handleApply}
        className="text-xs text-[var(--robin-amber)] hover:text-[var(--signal-cyan)] text-left leading-snug underline-offset-2 hover:underline"
        title={`Use: ${event.title}`}
      >
        {event.title}
      </button>
    </li>
  );
}
