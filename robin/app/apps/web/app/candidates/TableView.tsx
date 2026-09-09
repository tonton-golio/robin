'use client';

import { useSearchParams } from 'next/navigation';
import type React from 'react';
import {
  DATE_KIND_LABEL,
  flagClass,
  flagLabel,
  formatDate,
  isSortKey,
  ownerClass,
  ownerLabel,
  type Pipeline,
  primaryDate,
  SORT_COLUMNS,
  type SortDir,
  type SortKey,
  sortCandidates,
  stageLabel,
} from './model';

/**
 * Table view — the same snapshot as a sortable dense list.
 *
 * Sort state lives in the URL (`?sort=&dir=`) rather than component state, so a
 * particular reading ("everyone by oldest contact") is a link the user can keep.
 * Clicking the active header toggles direction; clicking another column starts
 * it in the direction that is useful first — ascending for names, descending
 * for dates, where the newest movement matters more than the oldest.
 */
export function TableView({
  pipeline,
  setParam,
}: {
  pipeline: Pipeline;
  setParam: (updates: Record<string, string | null>) => void;
}): React.ReactElement {
  const searchParams = useSearchParams();
  const sortParam = searchParams.get('sort');
  const sort: SortKey = isSortKey(sortParam) ? sortParam : 'stage';
  const dirParam = searchParams.get('dir');
  const dir: SortDir = dirParam === 'desc' ? 'desc' : 'asc';

  const rows = sortCandidates(pipeline, sort, dir);

  function onSort(key: SortKey, numeric: boolean) {
    if (key === sort) {
      setParam({ sort: key, dir: dir === 'asc' ? 'desc' : 'asc' });
      return;
    }
    setParam({ sort: key, dir: numeric ? 'desc' : 'asc' });
  }

  return (
    <div className="cand-tablewrap">
      <table className="cand-table">
        <caption className="cand-caption">
          {rows.length} candidates, sorted by{' '}
          {SORT_COLUMNS.find((c) => c.key === sort)?.label.toLowerCase() ?? sort} (
          {dir === 'asc' ? 'ascending' : 'descending'}). Notes expand in place.
        </caption>
        <thead>
          <tr>
            {SORT_COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.numeric ? 'cand-num' : undefined}
                aria-sort={sort === col.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button
                  className="cand-sortbtn"
                  type="button"
                  onClick={() => onSort(col.key, col.numeric)}
                >
                  {col.label}
                  <span className="cand-sortmark" aria-hidden="true">
                    {sort === col.key ? (dir === 'asc' ? '↑' : '↓') : '·'}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const date = primaryDate(c);
            return (
              <tr className="cand-row" key={c.name}>
                <td>
                  <span className="cand-rowname">{c.name}</span>
                  {c.flag ? <span className={flagClass(c.flag)}>{flagLabel(c.flag)}</span> : null}
                  {c.notes ? (
                    <details className="cand-notes">
                      <summary>Notes</summary>
                      <p>{c.notes}</p>
                    </details>
                  ) : null}
                </td>
                <td>{stageLabel(pipeline, c.stage)}</td>
                <td>
                  <span className={ownerClass(c.owner)}>{ownerLabel(c.owner)}</span>
                </td>
                <td className="cand-await-cell">{c.awaiting ?? '—'}</td>
                <td className="cand-num">{formatDate(c.lastContact)}</td>
                <td className="cand-num">
                  {formatDate(date.value)}
                  {date.value ? (
                    <span className="cand-dk cand-dk-inline">{DATE_KIND_LABEL[date.kind]}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
