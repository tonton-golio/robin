'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, ChevronDown, Clock3, RefreshCw } from 'lucide-react';
import type { CalendarTodayEvent } from '@/lib/calendar';
import type { TodayBullet, InboxItem, OpenThread } from '@/lib/today';
import { ActiveDocumentRegistration } from '@/components/shell/ActiveDocumentProvider';
import { NowOverview } from '@/components/today/NowOverview';
import type { CurrentOverview } from '@/lib/overview';

/** One durable event from Robin's append-only edit ledger. */
export interface AgentEdit {
  id: string;
  who: 'human' | 'robin';
  actor: string;
  summary: string;
  href: string;
  ts: string;
  meta: string;
}

export interface TodayDeckProps {
  overview: CurrentOverview;
  nowIso: string;
  dateLabel: string;
  briefBar: string;
  brief: TodayBullet[];
  briefUpdatedAt?: string;
  briefModifiedAt?: string;
  briefSource?: string;
  inbox: InboxItem[];
  openThreads: OpenThread[];
  stats: { pages: number; tasks: number; decisions: number; outputs: number };
  calendar: { available: boolean; events: CalendarTodayEvent[]; generatedAt?: string };
  edits: AgentEdit[];
}

const PRIMARY_SCHEDULE_LIMIT = 4;
const PRIMARY_RECEIPT_LIMIT = 4;

function fmtTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function scheduleLabel(event: CalendarTodayEvent): string {
  if (event.allDay) return 'All day';
  return fmtTime(event.start);
}

function isCurrent(event: CalendarTodayEvent, now: Date | null): boolean {
  if (!now || event.allDay) return false;
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start <= now.getTime() && end > now.getTime();
}

function isStillRelevant(event: CalendarTodayEvent, now: Date | null): boolean {
  if (!now || event.allDay) return true;
  const end = new Date(event.end).getTime();
  return !Number.isFinite(end) || end > now.getTime();
}

function receiptDate(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function TodayDeck(props: TodayDeckProps) {
  const router = useRouter();
  const [now, setNow] = useState<Date>(() => new Date(props.nowIso));
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);


  useEffect(() => {
    setNow(new Date());
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const refreshSources = useCallback(() => {
    router.refresh();
    showToast('Reloading Day from its source files…');
  }, [router, showToast]);

  const relevantEvents = useMemo(
    () => [...props.calendar.events]
      .sort((a, b) => a.start.localeCompare(b.start))
      .filter((event) => isStillRelevant(event, now)),
    [now, props.calendar.events],
  );

  const visibleEvents = relevantEvents.slice(0, PRIMARY_SCHEDULE_LIMIT);
  const laterEvents = relevantEvents.slice(PRIMARY_SCHEDULE_LIMIT);
  const visibleReceipts = props.edits.slice(0, PRIMARY_RECEIPT_LIMIT);
  const moreReceipts = props.edits.slice(PRIMARY_RECEIPT_LIMIT);
  const dayDocumentPath = 'Day · current overview';

  return (
    <article className="today-page" aria-labelledby="day-title">
      <ActiveDocumentRegistration
        path={dayDocumentPath}
        mode="view"
        writeState={{ kind: 'read-only' }}
        updatedAt={props.overview.generatedAt}
      />

      <header className="day-heading">
        <div>
          <p className="day-eyebrow">Day · working view</p>
          <h1 id="day-title">{props.dateLabel}</h1>
          <p className="day-heading-meta">
            <span>{props.briefBar}</span>
            <span>· Derived from canonical records</span>
          </p>
        </div>
        <button type="button" className="day-refresh" onClick={refreshSources}>
          <RefreshCw size={15} strokeWidth={1.7} aria-hidden="true" />
          <span>Reload sources</span>
        </button>
      </header>

      <NowOverview overview={props.overview} />

      <div className="day-work-grid">
        <section className="day-panel day-schedule" aria-labelledby="day-schedule-title">
          <DaySectionHeader
            id="day-schedule-title"
            label="Next"
            title="Schedule"
            count={props.calendar.available ? relevantEvents.length : undefined}
          />
          {!props.calendar.available ? (
            <DayEmpty
              title="Calendar snapshot unavailable"
              body="Robin did not infer a free day. The source file is missing, unreadable, or from another date."
            />
          ) : visibleEvents.length === 0 ? (
            <DayEmpty
              title={props.calendar.events.length === 0 ? 'No events today' : 'Schedule complete'}
              body={props.calendar.events.length === 0
                ? 'The calendar snapshot loaded and contains zero events.'
                : 'Every timed event in today’s snapshot has ended.'}
              positive
            />
          ) : (
            <ol className="day-schedule-list">
              {visibleEvents.map((event) => (
                <ScheduleRow key={event.id} event={event} current={isCurrent(event, now)} />
              ))}
            </ol>
          )}
          {laterEvents.length > 0 ? (
            <details className="day-inline-disclosure">
              <summary>
                <ChevronDown size={14} aria-hidden="true" />
                {laterEvents.length} later {laterEvents.length === 1 ? 'event' : 'events'}
              </summary>
              <ol className="day-schedule-list">
                {laterEvents.map((event) => (
                  <ScheduleRow key={event.id} event={event} current={isCurrent(event, now)} />
                ))}
              </ol>
            </details>
          ) : null}
          <p className="day-source">
            <code>.robin/calendar/today.json</code>
            {props.calendar.generatedAt ? ` · snapshot ${fmtTime(props.calendar.generatedAt)}` : null}
          </p>
        </section>

        <section className="day-panel day-waiting" aria-labelledby="day-waiting-title">
          <DaySectionHeader id="day-waiting-title" label="Follow-through" title="Waiting" />
          {props.overview.followThrough.watching.length ? (
            <ul className="day-now-list">
              {props.overview.followThrough.watching.map((item) => (
                <li key={item.path}>
                  <Link href={item.href}>{item.statement}</Link>
                  <p>{item.owner} · checkpoint {item.due}</p>
                  <p className="day-provenance">{item.reason}</p>
                </li>
              ))}
            </ul>
          ) : <DayEmpty title="No watched commitments" body="No active commitment currently qualifies for watching." />}
          <p className="day-source">Up to three recorded commitments with upcoming checkpoints.</p>
        </section>

        <aside className="day-panel day-receipts" aria-labelledby="day-receipts-title">
          <DaySectionHeader
            id="day-receipts-title"
            label="Robin"
            title="Receipts"
            count={props.edits.length}
            href="/activity"
          />
          {visibleReceipts.length === 0 ? (
            <DayEmpty title="No Robin writes recorded" body="The edit ledger has no recent non-web write to show." />
          ) : (
            <div className="day-receipt-list">
              {visibleReceipts.map((receipt) => <ReceiptRow key={receipt.id} receipt={receipt} />)}
            </div>
          )}
          {moreReceipts.length > 0 ? (
            <details className="day-inline-disclosure">
              <summary>
                <ChevronDown size={14} aria-hidden="true" />
                {moreReceipts.length} earlier {moreReceipts.length === 1 ? 'receipt' : 'receipts'}
              </summary>
              <div className="day-receipt-list">
                {moreReceipts.map((receipt) => <ReceiptRow key={receipt.id} receipt={receipt} />)}
              </div>
            </details>
          ) : null}
          <p className="day-source"><code>inbox/robin/edits/*.jsonl</code></p>
        </aside>
      </div>

      <div className="day-more" aria-label="More from today">
        <details className="day-disclosure">
          <summary>
            <span>
              <strong>Full brief</strong>
              <small>{props.brief.length} {props.brief.length === 1 ? 'item' : 'items'}</small>
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div className="day-disclosure-body">
            {props.brief.length > 0 ? (
              <ol className="day-brief-list">
                {props.brief.map((item, index) => (
                  <li key={`${item.text}-${index}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>{item.href ? <Link href={item.href}>{item.text}</Link> : item.text}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <DayEmpty
                title={props.briefSource ? 'No brief items were parsed' : 'No brief file found'}
                body={props.briefSource
                  ? `The file exists at ${props.briefSource}, but it did not yield a readable list item or paragraph.`
                  : 'Robin checked reports, remsleep, and recent handovers without finding a brief source.'}
              />
            )}
            <p className="day-source">
              {props.briefSource ? <code>{props.briefSource}</code> : 'No source filename'}
              {props.briefUpdatedAt ? ` · modified ${props.briefUpdatedAt}` : null}
            </p>
          </div>
        </details>



        <details className="day-disclosure">
          <summary>
            <span>
              <strong>Inbox and open threads</strong>
              <small>{props.inbox.length} inbox · {props.openThreads.length} threads</small>
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div className="day-disclosure-body day-secondary-grid">
            <section aria-labelledby="day-inbox-title">
              <h3 id="day-inbox-title">Inbox sources</h3>
              {props.inbox.length > 0 ? (
                <div className="day-secondary-list">
                  {props.inbox.map((item) => (
                    <Link href={item.href} key={item.path}>
                      <span>{item.title}</span>
                      <small>{item.path} · {item.age}</small>
                    </Link>
                  ))}
                </div>
              ) : (
                <DayEmpty
                  title="Inbox clear"
                  body="No unprocessed meeting or interview source was found."
                  positive
                />
              )}
              <Link className="day-text-link" href="/inbox">
                Open Inbox <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            </section>
            <section aria-labelledby="day-threads-title">
              <h3 id="day-threads-title">Recently touched</h3>
              {props.openThreads.length > 0 ? (
                <div className="day-secondary-list">
                  {props.openThreads.map((thread) => (
                    <Link href={thread.href} key={thread.href}>
                      <span>{thread.title}</span>
                      <small>{thread.age}</small>
                    </Link>
                  ))}
                </div>
              ) : (
                <DayEmpty title="No open threads" body="Nothing recently touched is waiting here." positive />
              )}
            </section>
          </div>
        </details>
      </div>

      <footer className="day-footer">
        <span>Vault</span>
        <Link href="/library">{props.stats.pages} pages</Link>
        <Link href="/tasks">{props.stats.tasks} tasks</Link>
        <Link href="/library">{props.stats.decisions} decisions</Link>
        <Link href="/publish">{props.stats.outputs} outputs</Link>
        <Link href="/health">Health</Link>
      </footer>

      {toast ? <div className="day-toast" role="status">{toast}</div> : null}
    </article>
  );
}

function DaySectionHeader({
  id,
  label,
  title,
  count,
  href,
}: {
  id: string;
  label: string;
  title: string;
  count?: number;
  href?: string;
}) {
  return (
    <header className="day-panel-heading">
      <div>
        <p>{label}</p>
        <h2 id={id}>{title}</h2>
      </div>
      {href ? (
        <Link href={href} aria-label={`Open all ${title.toLowerCase()}`}>
          {count ?? 0}
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      ) : count !== undefined ? (
        <span>{count}</span>
      ) : null}
    </header>
  );
}

function DayEmpty({
  title,
  body,
  positive = false,
}: {
  title: string;
  body: string;
  positive?: boolean;
}) {
  return (
    <div className="day-empty" data-positive={positive || undefined}>
      {positive ? <Check size={15} strokeWidth={1.8} aria-hidden="true" /> : <Clock3 size={15} strokeWidth={1.7} aria-hidden="true" />}
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

function ScheduleRow({ event, current }: { event: CalendarTodayEvent; current: boolean }) {
  return (
    <li className="day-schedule-row" data-current={current || undefined}>
      <time dateTime={event.start}>{scheduleLabel(event)}</time>
      <div>
        <strong>{event.title}</strong>
        <small>
          {[current ? 'Now' : null, event.classification, event.location].filter(Boolean).join(' · ') || 'Calendar event'}
        </small>
      </div>
    </li>
  );
}

function ReceiptRow({ receipt }: { receipt: AgentEdit }) {
  return (
    <article className="day-receipt-row">
      <div className="day-receipt-mark" aria-hidden="true" />
      <div>
        <Link href={receipt.href}>{receipt.summary}</Link>
        <p>
          <span>{receipt.actor}</span>
          {receiptDate(receipt.ts) ? ` · ${receiptDate(receipt.ts)}` : null}
          {receipt.meta ? ` · ${receipt.meta}` : null}
        </p>
      </div>
    </article>
  );
}
