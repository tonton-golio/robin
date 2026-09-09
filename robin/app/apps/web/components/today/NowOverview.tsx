import Link from 'next/link';
import type { CurrentOverview, OverviewItem } from '@/lib/overview';

function shortDate(value: string) { return value.slice(0, 10); }

function Items({ items, empty }: { items: OverviewItem[]; empty: string }) {
  if (!items.length) return <p className="day-provenance">{empty}</p>;
  return <ul className="day-now-list">{items.map((item) => (
    <li key={item.path}>
      <Link href={item.href}>{item.title}</Link>
      <p className="day-provenance">
        {item.owner ?? 'Owner not recorded'}
        {item.checkpoint ? ` · checkpoint ${shortDate(item.checkpoint)}` : ''}
        {item.state ? ` · ${item.state}` : ''}
      </p>
      {item.reviewReasons?.length ? <p className="day-provenance">{item.reviewReasons.join(" · ")}</p> : null}
      {item.nextAction || item.summary ? <p>{item.nextAction ?? item.summary}</p> : null}
    </li>
  ))}</ul>;
}

/** A disposable working view: every statement links back to a canonical page. */
export function NowOverview({ overview }: { overview: CurrentOverview }) {
  const coverage = overview.sourceCoverage;
  return <section className="day-now day-panel" aria-labelledby="day-now-title">
    <div className="day-panel-heading">
      <div><p>Current context</p><h2 id="day-now-title">Now</h2></div>
      <Link href="/library?view=thoughts">Thoughts to review</Link>
    </div>
    <div className="day-now-columns">
      <section aria-labelledby="day-now-actions">
        <h3 id="day-now-actions">Next actions</h3>
        <Items items={overview.nextActions.slice(0, 3)} empty="No next actions are ready without a review trigger. Check Needs you or the task board." />
        <p className="day-provenance"><Link href="/tasks">All tasks</Link> · {overview.totals.nextActions} ready next actions</p>
      </section>
      <section aria-labelledby="day-now-needs-you">
        <h3 id="day-now-needs-you">Needs you</h3>
        <Items items={overview.needsUser.slice(0, 3)} empty="No recorded items need clarification. Source coverage below may still be incomplete." />
        <p className="day-provenance">{overview.totals.needsUser} recorded review triggers · <Link href="/review">Decision review</Link></p>
      </section>
    </div>
    <details className="day-inline-disclosure">
      <summary>Outcomes and task housekeeping</summary>
      <h3>Active outcomes</h3>
      <Items items={overview.outcomes.slice(0, 3)} empty="No active outcomes are recorded." />
      {overview.totals.outcomes > 3 ? <Link href="/tasks">All {overview.totals.outcomes} active outcomes</Link> : null}
      <p className="day-provenance">{overview.taskHygiene.overdue} past recorded deadlines · {overview.taskHygiene.missingNextAction} missing next actions · {overview.taskHygiene.blocked} blocked · {overview.taskHygiene.backlog} in backlog. <Link href="/tasks">Review tasks</Link></p>
    </details>
    <details className="day-inline-disclosure">
      <summary>Recent changes and source freshness</summary>
      {overview.followThrough.changes.length ? <ul className="day-now-list">{overview.followThrough.changes.map((change) => <li key={change.id}>
        <Link href={change.href}>{change.summary}</Link>
        <p className="day-provenance">{shortDate(change.at)}</p>
      </li>)}</ul> : null}
      {!overview.followThrough.historyAvailable ? <p className="day-provenance">Commitment change history is unavailable.</p> : null}
      <ul className="day-now-list">{overview.relevantChanges.map((item) => <li key={item.path}>
        <Link href={item.href}>{item.title}</Link>
        <p className="day-provenance">Page updated {item.pageUpdatedAt ? shortDate(item.pageUpdatedAt) : 'unknown'}{item.sourceDate ? ` · record date ${shortDate(item.sourceDate)}` : ''}</p>
      </li>)}</ul>
      <p className="day-provenance">{coverage.records} retained meeting/report records · {coverage.datedRecords} with an explicit record date{coverage.latestRecordDate ? ` · latest ${shortDate(coverage.latestRecordDate)}` : ''}.</p>
      <ul className="day-now-list">{coverage.latest.map((item) => <li key={item.path}>
        <Link href={item.href}>{item.title}</Link>{item.sourceDate ? ` · ${shortDate(item.sourceDate)}` : ''}
      </li>)}</ul>
    </details>
    <p className="day-source">External source coverage unknown. Record dates and page edits do not prove a complete sync.</p>
    {overview.unreadablePaths.length ? <p className="day-provenance">Some canonical files could not be read. This view is incomplete.</p> : null}
  </section>;
}
