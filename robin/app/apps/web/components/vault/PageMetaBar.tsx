'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { RobinMeta } from '@robin/converter';
import { normalizeStatus } from '@/lib/task-display';
import { vaultPageHref } from '@/lib/routes';
import { useActiveDocument } from '@/components/shell/ActiveDocumentProvider';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'open', label: 'To do' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];

interface Conflict {
  yours: string;
  theirs: string;
  base?: string;
}

function fmtDate(raw?: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().slice(0, 10);
}

/**
 * The single PageMetaBar band — status (inline, live), due · owner · project,
 * parent · tags, src — with thin ink separators grouping it. Fields that don't
 * apply are omitted, never shown empty. There is no second row.
 *
 * On task pages the status select writes optimistically through
 * POST /api/task/update, guarded toward compare-and-set: if the server reports
 * the page changed underneath the edit (HTTP 409 with both values), the losing
 * write is SHOWN in a red conflict banner — Keep mine / Take Robin's / Open the
 * edit log — never silently swallowed. This is the page whose whole thesis is
 * two-actor legibility.
 */
export function PageMetaBar({
  meta,
  renderPath,
  isTask,
}: {
  meta: RobinMeta;
  renderPath: string;
  isTask: boolean;
}) {
  const router = useRouter();
  const { update: updateActiveDocument } = useActiveDocument();
  const [status, setStatus] = useState(meta.status ?? meta.state ?? 'open');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  async function writeStatus(next: string) {
    const prev = status;
    setStatus(next);
    setSaving(true);
    updateActiveDocument({ writeState: { kind: 'saving' } });
    setError(null);
    setConflict(null);
    try {
      const res = await fetch('/api/task/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: renderPath, patch: { status: next } }),
      });
      if (res.status === 409) {
        // Compare-and-set failed: the page changed under the edit. Surface both.
        const body = (await res.json().catch(() => ({}))) as Partial<Conflict>;
        setStatus(prev);
        setConflict({
          yours: next,
          theirs: body.theirs ?? 'changed',
          base: body.base,
        });
        updateActiveDocument({
          writeState: {
            kind: 'conflict',
            message: 'Robin wrote a newer task status before this change could land.',
          },
        });
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `update failed (${res.status})`);
      }
      updateActiveDocument({ writeState: { kind: 'saved', at: new Date().toISOString() } });
      router.refresh();
    } catch (e) {
      setStatus(prev);
      const message = e instanceof Error ? e.message : 'update failed';
      setError(message);
      updateActiveDocument({ writeState: { kind: 'error', message } });
    } finally {
      setSaving(false);
    }
  }

  const due = fmtDate(meta.due);
  const tags = meta.tags ?? [];

  return (
    <>
      {conflict ? (
        <div className="r-vault-conflict" role="alert" aria-live="assertive">
          <span className="warnpill">Write conflict</span>
          <div className="ct">Robin wrote a newer value while your status edit was open.</div>
          <p>
            Your change to <b>status</b> couldn&rsquo;t be saved: the page changed underneath you (compare-and-set
            failed on <span style={{ fontFamily: 'var(--font-mono)' }}>robin:updated</span>). Nothing was lost — both
            values are here. Pick which one lands.
          </p>
          <div className="diff">
            <div className="side">
              <div className="who">yours</div>
              status → <b>{conflict.yours}</b>
            </div>
            <div className="side robin">
              <div className="who">robin</div>
              status → <b>{conflict.theirs}</b>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="r-btn r-btn--primary" onClick={() => writeStatus(conflict.yours)}>
              Keep mine ({conflict.yours})
            </button>
            <button
              type="button"
              className="r-btn"
              onClick={() => {
                setConflict(null);
                updateActiveDocument({ writeState: { kind: 'saved' } });
                router.refresh();
              }}
            >
              Take Robin&rsquo;s ({conflict.theirs})
            </button>
            <Link className="r-btn r-btn--ghost" href={`/activity?path=${encodeURIComponent(renderPath)}`}>
              Open edit log ↗
            </Link>
          </div>
          {conflict.base ? <div className="m">CAS base = robin:updated @ {conflict.base}</div> : null}
        </div>
      ) : null}

      <div className="r-vault-metaband" aria-label="Page metadata">
        {isTask ? (
          <span className="r-vault-field">
            <span>status</span>
            <select
              className="r-vault-statusselect"
              aria-label="Task status"
              value={normalizeStatus(status)}
              disabled={saving}
              onChange={(e) => writeStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
        ) : meta.status ? (
          <span className="r-vault-field">
            <span>status</span>
            <span className="val">{meta.status}</span>
          </span>
        ) : null}

        {(due || meta.owner || meta.category) && <span className="sep" aria-hidden />}
        {due ? (
          <span className="r-vault-field">
            <span>due</span>
            <span className="val">{due}</span>
          </span>
        ) : null}
        {meta.owner ? (
          <span className="r-vault-field">
            <span>owner</span>
            <span className="val">{meta.owner}</span>
          </span>
        ) : null}
        {meta.category ? (
          <span className="r-vault-field">
            <span>project</span>
            <span className="val">{meta.category}</span>
          </span>
        ) : null}

        {(meta.parent || tags.length > 0) && <span className="sep" aria-hidden />}
        {meta.parent ? (
          <span className="r-vault-field">
            <span>parent</span>
            <span className="val">
              <Link href={vaultPageHref(`brain/tasks/${meta.parent}.html`)}>{meta.parent}</Link>
            </span>
          </span>
        ) : null}
        {tags.length > 0 ? (
          <span className="r-vault-field">
            <span>tags</span>
            <span className="r-vault-tags">
              {tags.map((t) => (
                <span key={t} className="r-vault-tag">
                  {t}
                </span>
              ))}
            </span>
          </span>
        ) : null}

        {error ? (
          <span className="r-vault-field" style={{ color: 'var(--red)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </>
  );
}
