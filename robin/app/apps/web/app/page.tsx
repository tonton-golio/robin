import { getTodaySnapshot } from '@/lib/today';
import { listEdits } from '@/lib/edit-store';
import { vaultPageHref } from '@/lib/routes';
import { TodayDeck, type AgentEdit } from '@/components/today/TodayDeck';

export const dynamic = 'force-dynamic';

/** ISO timestamp → deadpan mono meta ("14:02 · edit.saved"). */
function editMeta(ts: string, tool: string | undefined, kind: string | undefined, event: string): string {
  const t = new Date(ts);
  const clock = Number.isNaN(t.getTime())
    ? ''
    : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return [clock, kind, tool, event].filter(Boolean).join(' · ');
}

export default async function TodayPage() {
  const snap = await getTodaySnapshot();

  const briefBar = snap.date
    .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
    .toUpperCase();

  // Robin receipts come from the durable edit ledger. Web-originated saves are
  // human writes, so do not relabel or mix them into this Robin-only lane.
  const rawEdits = await listEdits({ limit: 20 }).catch(() => []);
  const edits: AgentEdit[] = rawEdits
    .filter((event) => event.origin !== 'web')
    .slice(0, 8)
    .map((e) => {
      const who = 'robin' as const;
      const summary = e.summary?.trim() || e.title?.trim() || e.page_path.replace(/^.*\//, '');
      return {
        id: e.id,
        who,
        actor: 'ROBIN',
        summary,
        href: vaultPageHref(e.page_path),
        ts: e.ts,
        meta: editMeta(e.ts, e.tool, e.kind, e.event),
      };
    });

  return (
    <TodayDeck
      overview={snap.overview}
      nowIso={snap.date.toISOString()}
      dateLabel={snap.dateLabel}
      briefBar={briefBar}
      brief={snap.brief}
      briefUpdatedAt={snap.briefUpdatedAt}
      briefModifiedAt={snap.briefModifiedAt}
      briefSource={snap.briefSource}
      inbox={snap.inbox}
      openThreads={snap.openThreads}
      stats={snap.stats}
      calendar={snap.calendar}
      edits={edits}
    />
  );
}
