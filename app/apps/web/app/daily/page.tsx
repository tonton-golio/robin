import Link from 'next/link';
import { CalendarDays, ArrowUpRight } from 'lucide-react';
import { listDailyLogs, type DailyLogItem } from '@/lib/catalog';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';

export const dynamic = 'force-dynamic';

function formatDay(date: string): string {
  // date is YYYY-MM-DD; render in UTC so the calendar day doesn't shift.
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

function DayCard({ item }: { item: DailyLogItem }) {
  const preview = item.outcomes.slice(0, 5);
  const extra = item.outcomes.length - preview.length;
  return (
    <Link href={item.href} className="group block no-underline">
      <Card className="gap-3 p-5 transition-colors hover:border-[var(--robin-amber)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-[15px] font-semibold text-foreground">{formatDay(item.date)}</h2>
          <div className="flex items-center gap-2">
            <Pill tone={item.sessions > 0 ? 'amber' : 'neutral'}>{item.sessions} session{item.sessions === 1 ? '' : 's'}</Pill>
            <ArrowUpRight size={15} className="text-muted-foreground transition-colors group-hover:text-[var(--robin-amber)]" />
          </div>
        </div>
        {preview.length > 0 ? (
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed text-muted-foreground">
            {preview.map((outcome, i) => (
              <li key={i}>{outcome}</li>
            ))}
            {extra > 0 ? <li className="list-none text-[12px] text-[var(--text-2)]">+{extra} more</li> : null}
          </ul>
        ) : item.summary ? (
          <p className="m-0 text-[13.5px] text-muted-foreground">{item.summary}</p>
        ) : null}
      </Card>
    </Link>
  );
}

export default async function DailyPage() {
  const days = await listDailyLogs();

  return (
    <div className="mx-auto max-w-[860px] px-5 py-10">
      <PageHeader
        eyebrow="Daily"
        title="The day, captured."
        sub="Each session end (clear, exit, compact) appends what it accomplished. The freshest record of Robin's in-CLI work, and the backbone of the EOD signoff."
      />

      {days.length === 0 ? (
        <Card className="items-center gap-2 p-12 text-center">
          <CalendarDays size={32} strokeWidth={1.5} className="mb-1 text-[var(--text-2)]" />
          <p className="m-0 text-base text-foreground">No sessions captured yet.</p>
          <p className="m-0 text-sm text-muted-foreground">
            Outcomes appear here after a session ends via <code className="font-mono text-[var(--robin-amber)]">/clear</code>,
            exit, or <code className="font-mono text-[var(--robin-amber)]">/compact</code>.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {days.map((item) => (
            <DayCard key={item.date} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
