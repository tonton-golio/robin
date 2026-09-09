'use client';

import React from 'react';
import { vaultFileHref, vaultPageHref } from '@/lib/routes';
import { EditDiff } from '@/components/edits/EditDiff';
import { EditActions } from '@/components/edits/EditActions';
import type { LedgerEvent } from './model';

const KIND_PILL: Record<string, { cls: string; label: string }> = {
  created: { cls: 'act-pill--created', label: 'Created' },
  edited: { cls: 'act-pill--edited', label: 'Edited' },
  reverted: { cls: 'act-pill--reverted', label: 'Reverted' },
  deleted: { cls: 'act-pill--deleted', label: 'Deleted' },
  ingest: { cls: 'act-pill--ingest', label: 'Ingest' },
};

function shortHash(hash?: string | null): string {
  if (!hash) return '∅';
  return hash.replace(/^sha256:/, '').slice(0, 7);
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(11, 19);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function pageHrefFor(path: string): string | null {
  if (!path) return null;
  return path.endsWith('.html') ? vaultPageHref(path) : vaultFileHref(path);
}

interface LedgerRowProps {
  event: LedgerEvent;
  unseen: boolean;
  diffOpen: boolean;
  undoOpen: boolean;
  onToggleDiff: (id: string) => void;
  onToggleUndo: (id: string) => void;
  onReverted: () => void;
}

export function LedgerRow({
  event,
  unseen,
  diffOpen,
  undoOpen,
  onToggleDiff,
  onToggleUndo,
  onReverted,
}: LedgerRowProps): React.ReactElement {
  const pill = KIND_PILL[event.kind] ?? KIND_PILL.edited!;
  const href = pageHrefFor(event.path);
  const canUndo = event.hasSnapshot && event.kind !== 'ingest';
  const stat = event.added || event.removed ? `+${event.added} −${event.removed}` : null;

  const provParts: string[] = [event.originRaw];
  if (event.tool) provParts.push(event.tool);
  if (event.kind !== 'ingest') {
    provParts.push(`${shortHash(event.beforeHash)}→${shortHash(event.afterHash)}`);
  }
  provParts.push(formatTime(event.ts));
  if (event.src) provParts.push(`src ${event.src}`);

  return (
    <div
      className={`act-lrow${unseen ? ' act-unseen' : ''}`}
      data-activity-row
      data-event-id={event.id}
      tabIndex={0}
      role="option"
      aria-selected={false}
      aria-label={`${pill.label}: ${event.title}`}
    >
      <div className="act-lrow-body">
        <div className="act-lrow-title">
          {href ? <a href={href}>{event.title}</a> : <span>{event.title}</span>}
          {event.path ? <span className="act-lrow-path r-mono">{event.path}</span> : null}
        </div>
        {event.summary ? <div className="act-lrow-summary">{event.summary}</div> : null}
        <div className="act-lrow-prov">
          <span className="r-actor" data-who={event.origin}>
            {event.origin}
          </span>{' '}
          <span className="r-mono">{provParts.join(' · ')}</span>
        </div>

        <div className="act-lrow-actions">
          <button
            type="button"
            className="act-rowbtn"
            data-act="diff"
            onClick={() => onToggleDiff(event.id)}
            disabled={event.kind === 'ingest' && !event.beforeHash && !event.afterHash}
          >
            {diffOpen ? 'Hide diff' : 'Diff'}
            <span className="act-rowbtn-key">x</span>
          </button>
          {canUndo ? (
            <button
              type="button"
              className="act-rowbtn"
              data-act="undo"
              onClick={() => onToggleUndo(event.id)}
            >
              {event.kind === 'deleted' ? 'Undo this delete' : 'Undo this edit'}
              <span className="act-rowbtn-key">u</span>
            </button>
          ) : null}
          {href ? (
            <a className="act-rowbtn" data-act="open" href={href}>
              {event.kind === 'ingest' ? 'Open page' : 'Open page'}
              <span className="act-rowbtn-key">o</span>
            </a>
          ) : null}
          {event.src ? (
            <a className="act-rowbtn" href={vaultFileHref(event.src)}>
              Open source
            </a>
          ) : null}
        </div>

        {/* Controlled diff panel (keyboard `x`). */}
        <EditDiff id={event.id} open={diffOpen} onOpenChange={() => onToggleDiff(event.id)} />

        {/* Controlled undo panel (keyboard `u`) — previewed + red confirm. */}
        {canUndo ? (
          <EditActions
            id={event.id}
            hasSnapshot={event.hasSnapshot}
            snapshotHash={shortHash(event.beforeHash)}
            kind={event.kind}
            open={undoOpen}
            onOpenChange={() => onToggleUndo(event.id)}
            onReverted={onReverted}
            hideButton
          />
        ) : null}
      </div>

      <div className="act-lrow-side">
        <span className={`act-pill ${pill.cls}`}>{pill.label}</span>
        {stat ? <span className="act-dstat r-mono">{stat}</span> : null}
      </div>
    </div>
  );
}
