'use client';

import type { RollupCounts, RollupFilter } from './task-view';

const FILTERS: { key: RollupFilter; label: string; count: (c: RollupCounts) => number; od?: boolean }[] = [
  { key: 'all', label: 'open', count: (c) => c.open },
  { key: 'overdue', label: 'overdue', count: (c) => c.overdue, od: true },
  { key: 'blocked', label: 'blocked', count: (c) => c.blocked },
  { key: 'mine', label: 'mine', count: (c) => c.mine },
  { key: 'done', label: 'done this week', count: (c) => c.done },
];

/**
 * The tasks page's headline block: a level-2 card (`--card` + `--offset`) marked
 * with a 3px `--blue` left rule, stating the day's thesis over click-to-filter
 * counts. See `.tk-rollup` in styles/page-tasks.css.
 *
 * `recede` adds `.outline` while the calendar band is open: the accent left rule
 * drops and the card settles to level 1, so only one accented surface is ever
 * forward at a time.
 */
export function Rollup({
  thesis,
  counts,
  active,
  onFilter,
  recede,
}: {
  thesis: string;
  counts: RollupCounts;
  active: RollupFilter;
  onFilter: (rf: RollupFilter) => void;
  recede: boolean;
}) {
  return (
    <div className={`tk-rollup${recede ? ' outline' : ''}`}>
      <span className="tk-rollup-corner" aria-hidden>
        ®
      </span>
      <div className="tk-rollup-t">{thesis}</div>
      <div className="tk-rollup-counts" role="group" aria-label="Rollup filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`tk-cbtn${f.od ? ' od' : ''}`}
            aria-pressed={active === f.key}
            onClick={() => onFilter(f.key)}
          >
            <span className="tk-cbtn-n">{f.count(counts)}</span>
            {f.label}
          </button>
        ))}
      </div>
      <div className="tk-rollup-m">
        counts are live · click a count to filter the view below · state persists in ?rf=
      </div>
    </div>
  );
}
