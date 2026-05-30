import Link from 'next/link';
import {
  Calendar,
  Inbox,
  Sparkles,
  Network,
  FileText,
  Sun,
  Wand2,
  CheckCircle2,
  CircleDot,
  AlertOctagon,
  Pause,
  Circle,
} from 'lucide-react';
import { ToolLaunchButtons } from '@/components/widgets/ToolLaunchButtons';
import { getTodaySnapshot } from '@/lib/today';
import { greet } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const snap = await getTodaySnapshot();
  const hour = snap.date.getHours();
  const greeting =
    hour < 5 ? 'Still up?' :
    hour < 12 ? greet('Good morning') :
    hour < 17 ? greet('Good afternoon') :
    hour < 22 ? greet('Good evening') :
    greet('Late night work');

  return (
    <div className="today-page">
      <header className="today-hero">
        <span className="today-date">{snap.dateLabel} · week {weekNumber(snap.date)}</span>
        <h1 className="today-title">{greeting}</h1>
        <p className="today-sub">
          {snap.brief.length > 0
            ? `${snap.brief.length} thing${snap.brief.length === 1 ? '' : 's'} matter${snap.brief.length === 1 ? 's' : ''} today.`
            : 'No brief yet today — run /morning-brief to get oriented.'}
        </p>
      </header>

      <div className="today-grid">
        <div className="today-col">
          <section className="today-card">
            <div className="today-card-head">
              <h2><Sun size={14} strokeWidth={1.5} /> Today&apos;s brief</h2>
              {snap.briefUpdatedAt && <span className="today-list-meta">{snap.briefUpdatedAt}</span>}
            </div>
            <div className="today-card-body">
              {snap.brief.length === 0 ? (
                <div className="today-empty">
                  <Wand2 size={14} strokeWidth={1.5} />
                  Run <code style={{ color: 'var(--robin-amber)' }}>/morning-brief</code> to generate one.
                </div>
              ) : (
                <div className="today-bullets">
                  {snap.brief.map((b, i) => (
                    <div key={i} className="today-bullet" data-tone={b.tone ?? 'cyan'}>
                      <span>{b.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="today-card">
            <div className="today-card-head">
              <h2><Wand2 size={14} strokeWidth={1.5} /> Quick launch</h2>
            </div>
            <div className="today-launch">
              <ToolLaunchButtons />
              <Link href="/graph"><Network size={16} strokeWidth={1.5} /> Open graph</Link>
              <Link href="/chat"><Sparkles size={16} strokeWidth={1.5} /> Ask Robin</Link>
            </div>
          </section>
        </div>

        <div className="today-col">
          <section className="today-card">
            <div className="today-card-head">
              <h2><Calendar size={14} strokeWidth={1.5} /> Calendar</h2>
              <span className="today-list-meta">
                {snap.calendar.available
                  ? snap.calendar.generatedAt
                    ? `synced ${timeAgo(snap.calendar.generatedAt)}`
                    : `${snap.calendar.events.length} event${snap.calendar.events.length === 1 ? '' : 's'}`
                  : 'no live source'}
              </span>
            </div>
            <div className="today-card-body">
              {!snap.calendar.available ? (
                <div className="today-empty">
                  <Calendar size={14} strokeWidth={1.5} />
                  Run <code style={{ color: 'var(--robin-amber)' }}>/check-calendar</code> to sync today&apos;s events.
                </div>
              ) : snap.calendar.events.length === 0 ? (
                <div className="today-empty">No events today.</div>
              ) : (
                <div className="today-list">
                  {snap.calendar.events.map((evt) => (
                    <div key={evt.id} className="today-list-row">
                      <span className="today-list-meta" style={{ minWidth: '4.5em' }}>
                        {evt.allDay ? 'all day' : eventTime(evt.start)}
                      </span>
                      <span>{evt.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="today-card">
            <div className="today-card-head">
              <h2><Inbox size={14} strokeWidth={1.5} /> Inbox to ingest</h2>
              <span className="today-list-meta">{snap.inbox.length}</span>
            </div>
            <div className="today-card-body">
              {snap.inbox.length === 0 ? (
                <div className="today-empty">Inbox clear.</div>
              ) : (
                <div className="today-list">
                  {snap.inbox.map((item) => (
                    <Link key={item.path} href={item.href}>
                      <span>{item.title}</span>
                      <span className="today-list-meta">{item.age}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="today-card">
            <div className="today-card-head">
              <h2><CheckCircle2 size={14} strokeWidth={1.5} /> Tasks</h2>
              <Link href="/tasks">all →</Link>
            </div>
            <div className="today-card-body">
              {snap.topTasks.length === 0 ? (
                <div className="today-empty">No active tasks.</div>
              ) : (
                <div className="today-list">
                  {snap.topTasks.map((t, i) => {
                    const due = formatDue(t.due);
                    return (
                      <Link key={i} href={t.href} className="today-task-row">
                        <span className="task-state" title={t.state}>{stateIcon(t.state)}</span>
                        <span className="task-title">{t.title}</span>
                        <span className="task-meta">
                          {t.priority && <span className="pill" data-prio={t.priority}>{t.priority}</span>}
                          {due && <span className="pill" data-due>{due}</span>}
                          {t.owner && <span className="owner">{t.owner}</span>}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

        </div>
      </div>

      <div className="today-stats">
        <span><FileText size={12} strokeWidth={1.5} /> <strong>{snap.stats.pages}</strong> pages</span>
        <span>·</span>
        <span><strong>{snap.stats.tasks}</strong> tasks</span>
        <span>·</span>
        <span><strong>{snap.stats.decisions}</strong> decisions</span>
        <span>·</span>
        <span><strong>{snap.stats.outputs}</strong> outputs</span>
      </div>
    </div>
  );
}

function eventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function weekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function stateIcon(state: string) {
  switch (state) {
    case 'in-progress':
    case 'in progress':
      return <CircleDot size={13} strokeWidth={1.5} style={{ color: 'var(--robin-amber)' }} />;
    case 'done':
    case 'completed':
    case 'closed':
      return <CheckCircle2 size={13} strokeWidth={1.5} style={{ color: '#6ba368' }} />;
    case 'blocked':
      return <AlertOctagon size={13} strokeWidth={1.5} style={{ color: 'var(--warning-rust)' }} />;
    case 'archived':
      return <Pause size={13} strokeWidth={1.5} style={{ color: 'var(--text-2)' }} />;
    default:
      return <Circle size={13} strokeWidth={1.5} style={{ color: 'var(--text-2)' }} />;
  }
}

function formatDue(due?: string): string | null {
  if (!due) return null;
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return null;
  const now = Date.now();
  const diff = date.getTime() - now;
  const day = 86400000;
  const days = Math.round(diff / day);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return `in ${days}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
